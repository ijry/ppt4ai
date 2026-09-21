# 预设几何词逐字保存设计

> 状态：已实现（2026-09-04，`fb66795`）
> 日期：2026-09-04

## 1. 目标

让 `a:prstGeom/@prst` 逐字进入模型。今天导入端把它收敛成 `rect`/`roundRect`/`ellipse`/`triangle` 四个，**无源导出因此把用户文件里的 `chevron` 写成 `rect`** —— 与 `prstDash` 那刀修掉的是同一类损坏：不是渲染近似，是改写用户的文件。

## 2. 探针结果（实测）

八个形状，只有 `prst` 不同（`preset-probe.test.ts`，已删除）。逐列是：模型值、`createPptx` 写出的词、未编辑时源包是否同尺寸、把 bounds 挪动后源包里的词：

```
rect        model=rect       standalone=rect       unedited-same=true  after-move=rect
roundRect   model=roundRect  standalone=roundRect  unedited-same=true  after-move=roundRect
ellipse     model=ellipse    standalone=ellipse    unedited-same=true  after-move=ellipse
triangle    model=triangle   standalone=triangle   unedited-same=true  after-move=triangle
chevron     model=rect       standalone=rect       unedited-same=true  after-move=chevron
star5       model=rect       standalone=rect       unedited-same=true  after-move=star5
hexagon     model=rect       standalone=rect       unedited-same=true  after-move=hexagon
rightArrow  model=rect       standalone=rect       unedited-same=true  after-move=rightArrow
```

**四个不同的词塌成 `rect` 并被无源导出写进文件**。源包路径的 `after-move` 一列之所以还保着原词，是因为写回里有一处与 `collapsedDashStyle` 完全同构的补丁（`writeback.ts` 的 `importedPreset`，另一处在 `master-layout-writeback.ts` 的 `sourcePreset`）：它先把源词塌成四个之一再比较，于是「模型说 rect、源说 chevron」被判为相等。

## 3. 关键决策

**决策 1：模型逐字保存这个词，能画的仍只有四个**

`PresetGeometry` 从四值联合放宽为「`prst` 的词」。ECMA-376 有 187 个预设，它们的轮廓来自一张 guide 公式表，**本环境无法核实**（`learn.microsoft.com`/`msdn` 被网络策略拦掉），因此**不发明任何轮廓**：未知词按矩形绘制 —— 与今天像素完全相同 —— 但它的名字不再被改写。这与 `prstDash` 那刀同一条：**模型记录文件说了什么，分组是绘制层的方言**。

**决策 2：校验只查词形，不做枚举白名单**

`/^[A-Za-z][A-Za-z0-9]*$/`。白名单需要那张查不到的表；而 `prst` 在 schema 里本就是枚举，我们的职责是**保存**而不是替 PowerPoint 做枚举校验。写出前一律 XML 转义（此前是四个字面量所以两处 `serializeGeometry` 都没转义）。

**决策 3：删掉两处「先塌再比」**

`importedPreset` 与 `sourcePreset` 存在的唯一理由是模型表达不了那些词。模型能逐字持有之后它们变成障碍（也会让「把 rect 改成 chevron」这类真实变化的比较变得可疑），改成逐字比较 —— 与 dash 那刀第三条决策完全同构。

**决策 4：图片的遮罩词同样逐字保存**

`p:pic` 的 `a:prstGeom` 走 `ImageElement.maskPreset`，此前同样被收敛，因此一张裁成星形的图片在无源导出里变成矩形。同一条理由、同一个改法；遮罩画不出来的词按矩形遮罩。

**决策 5：`a:avLst` 调整值仍不建模**

`a:gd`（形状调整手柄的值）需要与那张公式表配套才有意义。无源生成继续写空 `<a:avLst/>`（合法，表示用默认调整值），源包路径把整个 `prstGeom` 节点的其余部分逐字留在原处。

## 4. 契约（增量）

`@ppt4ai/model` 与 `@ppt4ai/geometry`：`PresetGeometry` 放宽为词；`createPresetPath` 增加默认分支（未知词 → 矩形路径）；`validateDocument` 用词形校验 shape/text 的 `preset` 与 image 的 `maskPreset`。

`@ppt4ai/pptx-import`：`parsePreset`/`parseOptionalPreset`/`parseImageMaskPreset` 返回源词，缺省仍是 `rect`（形状）与字段缺席（文本、遮罩）。

`@ppt4ai/pptx-export`：两处 `serializeGeometry` 转义并写模型值；`importedPreset`/`sourcePreset` 逐字比较；图片外观写回的 `supportedMasks` 白名单随之放宽。

## 5. 测试策略

- **导入**：`chevron`/`star5`/`flowChartMagneticDisk` 等词逐字进模型；缺省与空值仍为 `rect`；文本元素与图片遮罩同款
- **模型**：词形合法通过校验，`bad token!` 之类被拒
- **几何/绘制**：未知词画出与 `rect` 逐字相同的路径；四个已知词不变
- **往返**：`chevron` 经 standalone 写出后能重新导入为 `chevron`（此前变 `rect`）；源包改 bounds 时 `prstGeom` 的其余部分（含 `a:avLst/a:gd`）逐字保留；未编辑逐字节不变
- **回归**：现有 1530 项

## 6. 已知限制

- 未知词仍按矩形绘制（决策 1）：轮廓不对，但文件里的名字与调整值不再被改写
- `a:custGeom` 仍完全不建模
- `a:avLst` 的调整值不建模（决策 5），因此无源生成的形状只能是默认调整值的那一份
- 遮罩画不出来的图片按矩形遮罩（决策 4）
