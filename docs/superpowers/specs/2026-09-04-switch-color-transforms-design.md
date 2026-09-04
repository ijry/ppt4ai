# 开关式颜色变换设计

> 状态：设计
> 日期：2026-09-04

## 1. 目标

让没有 `val` 属性的颜色变换（`a:comp`、`a:inv`、`a:gray` 等开关式元素）进入模型。上一刀（颜色变换逐字保存）把带值的变换全部收下，并如实记下这一处残留：`ColorTransform.value` 是必填数值，因此开关式的三个词**仍然进不了模型、仍会在无源导出时丢失**。这是这条「导入收敛、导出逐字」损坏线上最后一个明确项。

## 2. 探针结果（实测）

一个填充色带四个变换：`<a:srgbClr val="4472C4"><a:gray/><a:inv/><a:comp/><a:lumMod val="75000"/></a:srgbClr>`（`switch-transform-probe.test.ts`，已删除）：

```
model     : [{"type":"lumMod","value":75000}]
standalone: <a:solidFill><a:srgbClr val="4472C4"><a:lumMod val="75000"/></a:srgbClr></a:solidFill>
after-move: <a:solidFill><a:srgbClr val="4472C4"><a:gray/><a:inv/><a:comp/><a:lumMod val="75000"/></a:srgbClr></a:solidFill>
```

**三个开关全被丢掉，无源导出写出的颜色少了它们**。源包路径的 `after-move` 一列还保着，是因为 `sourceColor` 的镜像同样丢掉它们、两边比较相等 —— 与前几刀一样是「凑巧安全」，而不是有意保留。

## 3. 关键决策

**决策 1：`value` 变为可选，缺席即表示开关**

```ts
export interface ColorTransform {
  type: ColorTransformType
  /** Absent for the switch-shaped transforms (`a:comp`, `a:inv`, `a:gray`), which carry no `val`. */
  value?: number
}
```

导出端 `serializeColorXml` 已经用 `attrs([['val', transform.value]])` 拼属性，`undefined` 自动省略，因此 `<a:comp/>` 原样写出，不需要新的分支。

**决策 2：三个开关只保存、不计算**

这一条与上一刀「`hue`/`hueOff` 只存不算」同一条纪律，理由逐个成立：

- `a:comp`（补色）的具体算法我无法从手头资料确认；
- `a:gray`（灰度）取决于亮度权重（Rec.601 与 Rec.709 的系数不同，肉眼可分），仓库里也没有既有权重可复用 —— 现成的 HSL 去饱和是**另一种**语义，不能假称它就是 `a:gray`；
- `a:inv`（反色）的空间同样不确定（逐通道取反 vs 其他空间的反演）。

三者猜错都会把颜色变到别处，而**保存下来不算**至少让文件不被改写、渲染保持今天的样子。

**决策 3：解析器显式跳过无值变换**

`factor = transform.value / 100000` 在 `value` 缺席时会变成 `NaN`，把颜色算成 `NaN` 并最终写出坏值。因此在循环开头就跳过没有值的变换 —— 这不是「顺带的安全网」，是决策 2 能成立的前提。

**决策 4：校验保持分档，只是允许缺席**

`value` 在场时按上一刀的分档判断（固定百分比 `0..100000`、`*Mod` 非负、`*Off` 带符号、其余整数）；缺席时只要求 `type` 是词。

## 4. 契约（增量）

`@ppt4ai/model`：`ColorTransform.value` 可选；`applyColorTransforms` 跳过无值项；校验允许缺席。

`@ppt4ai/pptx-import`：没有 `val` 的子元素记为 `{ type }`。

`@ppt4ai/pptx-export`：`color-source.ts` 的镜像同款读出无值形态（否则源包比较又会把它们当作不存在）。

## 5. 测试策略

- **导入**：`<a:gray/><a:inv/><a:comp/>` 三个进模型且无 `value`；混在带值变换之间时顺序保持
- **模型**：无值变换不改变解析出的颜色（不产生 `NaN`）；校验接受无值、拒绝非词类型
- **往返**：standalone 写出 `<a:comp/>` 形态并能重新导入；源包无关编辑后逐字保留；未编辑逐字节不变
- **回归**：现有 1570 项

## 6. 已知限制

- `a:comp`/`a:inv`/`a:gray` 只保存不计算（决策 2），颜色按未施加它们的样子渲染
- 与上一刀相同：`hue`/`hueOff`/`gamma`/`invGamma`/逐通道变换也只保存不计算
