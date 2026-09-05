# 图案填充切片记录

> 状态：已实现（2026-09-05，`8fe9e56`）
> 日期：2026-09-05

## 问题

`a:pattFill` 完全未建模，导入后元素**没有 `fill` 键**（不是颜色不准，是形状看不见）；主题 `fillStyleLst` 里的图案条目解析为 `null`，`fillRef` 指向它时解析不到填充；无源导出写不出填充节点，图案彻底抹掉；仅源包写回保留（`fillNodeNames` 包含 `pattFill`）。

这类损失比颜色降级更糟——元素什么都画不出。径向渐变（`a:path`）修复前是同一种问题（`afb9f71`）。

## 方案

`PatternFill` 作为 `Fill` 的一种形式，携带 `preset`/`foreground`/`background` 三个字段。`color` 同时承载前景色，使只认 `color` 的消费者（命中测试、缩略图、导出降级分支）把图案画成前景色而非丢失元素——与渐变那刀用 `color` 承载第一停靠点同一纪律。

真实纹理绘制留作下一刀：`createPattern` 需要离屏 tile，而 `thumbnail-worker.ts` 在 worker 里没有 canvas API，得走 `OffscreenCanvas`。本刀绘制层一行不改。

## 契约

**`@ppt4ai/model`**：
- `PatternFill` 接口（`preset: PresetPattern; foreground: Color; background: Color`）
- `PresetPattern` 类型（`string`，与 `PresetGeometry` 对称）
- `PAINTED_PRESET_PATTERNS` 常量（空数组，下一刀填入）
- `Fill.pattern?: PatternFill` 替换原先的 `pattFill` 占位注释
- `ResolvedPattern` 接口（两个颜色已解析）
- `validatePatternFill` 函数（校验两个颜色 + `preset` 非空）

**`@ppt4ai/pptx-import`**：
- `parseShapeFill` 与 `parseStyleFill` 都新增 `pattFill` 分支
- 前景色作为 `color` 回退（`foreground ?? { type: 'srgb', v: '000000' }`）
- 解析 `fgClr`/`bgClr` 与 `@prst`，三个属性全在时返回 `PatternFill`

**`@ppt4ai/render`**：
- `resolvedFillPattern(fill, context)` 平行于 `resolvedFillGradient`
- 两个颜色都解析失败时返回 `undefined`，节点的 `resolvedFillColor` 仍是前景色
- `createShapeNode`/`createTextNode` 都调用并挂到节点的 `resolvedFillPattern?`

**`@ppt4ai/pptx-export`**：
- `serializePatternFillXml(fill)` 写 `<a:pattFill prst="…"><a:fgClr>…</a:fgClr><a:bgClr>…</a:bgClr></a:pattFill>`
- `serializeThemeFillXml` 内也走同一函数（主题条目与元素填充同构）
- `sourceFill` 识别 `pattFill` 并返回保留标记，写回时不覆写

## 验证

五个测试文件（每层一个）钉住完整周期：

- **导入** — 带 alpha 的前景与背景色、`preset` 逐字、缺失属性时回退
- **场景** — 两色解析、`resolvedFillColor` 保持前景色、主题条目里的 `phClr` 替换
- **无源导出** — `<a:pattFill>` 节点输出、alpha 保留、填充缺失时不写节点
- **源包写回** — `extLst` 原样存活证明未重写、`pattFill` 识别为保留节点

全部 1821 项测试通过，四个门禁绿灯。

## 已知限制

**绘制层今天仍视所有图案为前景色平铺**（`pct5` 与 `pct90` 视觉相同）—— 下一刀在三条绘制路径里实现真实纹理，`OffscreenCanvas` 解决 worker 环境限制。数据层无耦合：`resolvedFillPattern` 已经携带完整信息，绘制分支检查 `PAINTED_PRESET_PATTERNS` 就能判断是否真画。
