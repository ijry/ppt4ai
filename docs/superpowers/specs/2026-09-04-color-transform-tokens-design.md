# 颜色变换逐字保存与饱和度/色相设计

> 状态：设计
> 日期：2026-09-04

## 1. 目标

让 `a:srgbClr` 等颜色节点下的**全部**子变换进入模型，并让能算的那几族真正影响解析出来的颜色。今天只认七种（`tint`/`shade`/`lumMod`/`lumOff`/`alpha`/`alphaMod`/`alphaOff`），其余一律丢弃 —— 这是 dash、`prstGeom`、`buAutoNum` 之后同一类损坏的第四处，而且它**同时**改变渲染结果：Office 主题的填充与渐变大量使用 `satMod`，丢掉它意味着颜色的饱和度不对。

## 2. 探针结果（实测）

同一个 `accent1`（`4472C4`）填充，只改变换列表，看场景解析出来的颜色（`transform-probe.test.ts`，已删除）：

```
none                     : {"rgb":"4472C4","alpha":100000}
lumMod 75000             : {"rgb":"2F5597","alpha":100000}
lumMod 75000 + satMod 160000: {"rgb":"2F5597","alpha":100000}
```

**加上 `satMod` 之后颜色一个位都没变** —— 它对渲染完全无效。读代码可以看到两个叠在一起的原因：`parseColorTransforms` 的白名单只有七个词，而且 `parsePercentage` 的上限是 `100000`，所以 `satMod val="160000"` **即使加进白名单也会被丢掉**。丢在导入期，因此写出的文件也少了那一行。

## 3. 关键决策

**决策 1：模型收下任何变换，解析只算认得的**

`ColorTransform` 的 `type` 放宽为词（`isOoxmlToken`），`value` 为整数。这与前三刀同一条：模型记录文件说了什么。解析器只对它理解的族做数学，其余**原样带过**（不参与计算、也不丢失）—— 因此往返完整，而渲染只在能确定的地方改进。

**否决「只加 sat/hue 四个词」**：那仍会丢掉 `comp`、`gamma`、`red`/`green`/`blue` 等，而它们对往返的破坏与 `satMod` 完全一样。

**决策 2：新增 `satMod`/`satOff`/`hueMod` 的数学，沿用既有 lum 的写法**

仓库已有的 `lumMod`/`lumOff` 在 HSL 空间里做 `l * factor` 与 `l + factor` 并 clamp。饱和度与色相是同一族的直接类比：

| 词 | 数学 | 依据 |
|---|---|---|
| `satMod` | `s * value/100000` | 与既有 `lumMod` 同构 |
| `satOff` | `s + value/100000` | 与既有 `lumOff` 同构 |
| `hueMod` | `h * value/100000`（对 360 取模） | 同上，色相是角度 |

**`hue` 与 `hueOff` 不做数学**：它们在 schema 里是**角度**（1/60000 度）而不是百分比，与 `hueMod` 单位不同 —— 这一点我无法从手头资料核实，猜错会把色相转到别处。两者仍**逐字保存**（决策 1），只是不参与计算。同理 `comp`/`inv`/`gray`/`gamma`/`invGamma` 与逐通道的 `red*`/`green*`/`blue*` 也只保存不计算。

**决策 3：取值范围按类型分档，不再一律 `0..100000`**

`alpha`/`alphaMod`/`alphaOff`/`tint`/`shade` 保持 `0..100000`（它们在 schema 里是 `ST_PositiveFixedPercentage`）。`*Mod` 允许任意非负整数（`satMod val="160000"` 是 Office 自己的值），`*Off` 允许带符号整数，其余未知类型只要求整数。**这是本刀真正的修复点之一**：范围而不只是白名单，才是 `satMod` 被丢掉的第二个原因。

**决策 4：导出两侧逐字**

`color-source.ts` 的镜像与 `serializeColorXml` 都按模型逐字读写，因此源包里的 `satMod` 在无关编辑下逐字存活，而无源生成也不再少写一行。

## 4. 契约（增量）

`@ppt4ai/model`：`ColorTransformType` 放宽为词；`applyColorTransforms` 新增 sat/hue-mod 三族；校验按决策 3 分档。

`@ppt4ai/pptx-import`：`parseColorTransforms` 收下任何 token 类型，按类型判范围。

`@ppt4ai/pptx-export`：`sourceColor` 的镜像同款放宽。

## 5. 测试策略

- **导入**：`satMod val="160000"`、`hueOff`、`comp` 各自逐字进模型；非整数与越界 alpha 仍被忽略
- **模型**：`satMod`/`satOff`/`hueMod` 改变解析结果（用具体 RGB 钉住）；未知词不改变结果也不报错；校验按分档接受/拒绝
- **场景**：带 `lumMod`+`satMod` 的 scheme 色解析出与 PowerPoint 同一族的颜色（用算得出的值钉住，不宣称与阅读器逐位相同）
- **往返**：源包无关编辑后 `satMod` 逐字保留；standalone 写出全部变换并能重新导入
- **回归**：现有 1545 项

## 6. 已知限制

- `hue`/`hueOff`（角度单位未核实）、`comp`/`inv`/`gray`/`gamma`/`invGamma`、逐通道 `red*`/`green*`/`blue*` 只保存不计算：颜色按未施加它们的样子渲染
- HSL 空间的 sat/lum 数学与 PowerPoint 的实际实现未经阅读器对照（本机无阅读器）
- 变换顺序按文件顺序依次施加（既有行为，未变）
