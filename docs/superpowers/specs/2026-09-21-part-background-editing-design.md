# 母版/版式背景编辑与写回设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

补上母版/版式自身 `p:bg` 的编辑命令与源包写回。导入端早已能读母版/版式背景（含图片，`inherited-picture-background.test.ts`），standalone 生成也早已写出（`standalone-inherited-background.test.ts`），唯独：①engine 没有改母版/版式背景的命令;②源写回 `rewriteMasterXml`/`rewriteLayoutXml` 只改 `defaults` 与 `colorMap`，从不碰 `p:bg`。二者一起补。

## 2. 关键决策

**决策 1：engine 加 `setMasterBackground` / `setLayoutBackground`，镜像 `setSlideBackground`**

同款签名（`background: SlideBackground | null`，null 清除）、同款「先 clone→改→`validateDocument`→commit」流程、同款提交路径（`['masters', id, 'background']` / `['layouts', id, 'background']`），因此撤销/重做天然可用。母版无父级，清除即裸；版式清除后回落母版。

**决策 2：源写回复用幻灯片背景那套「补丁优先、结构变整体替换、清除即删除」**

`master-layout-writeback.ts` 里新增自包含的 `rewriteBackground`（`sourcePartBackground` 镜像导入的 `parseBackground`，`partBackgroundsEqual` 判等，`serializePartBackgroundNode` 写节点），与 `writeback.ts` 里幻灯片的 `backgroundReplacements` 同构：纯色/渐变/图案改动只 patch `p:bgPr` 内的 fill 节点（未知兄弟存活）；`p:bgRef`↔fill 的结构变化整体替换；清除删除整个 `p:bg`；源无 `p:bg` 时插在 `p:spTree` 前。`rewriteMasterXml`/`rewriteLayoutXml` 加可选 `background` 参数，`writeback.ts` 从 `master.background`/`layout.background` 传入。

**决策 3：图片背景写回明确不做**

`p:bg/a:blipFill` 需要媒体部件与关系（另一套物化路径），编辑命令也从不产出图片背景，因此 `rewriteBackground` 遇到 `pictureFill` 直接不改源（`sourcePartBackground` 把源里的 blipFill 读成占位 pictureFill，配合判等逻辑让「源是图片、模型也没动它」时保持原样）。standalone 生成路径的图片背景不受影响（那条路已完整）。

## 3. 测试策略（TDD）

- **engine**（`engine/part-background.test.ts`，6 项）：master/layout 各设置+撤销、null 清除、缺失抛错。
- **写回**（`master-layout-writeback.test.ts` 追加 7 项）：patch 既有母版背景 fill 节点、无背景时插入、清除删除、匹配源时逐字节不变、不传参不动、插入渐变版式背景、图片背景不引入。
- **回归**：全量 2422 项。

## 4. 已知限制

- 图片背景仍不能通过写回引入或修改（需要媒体物化路径；standalone 生成不受此限）。
- 编辑器还没有改母版/版式背景的 UI 面板（engine 命令已具备，面板是独立切片）。
- 母版/版式内未建模的 `a:extLst` 等在 fill 结构变化整体替换时可能丢失（与幻灯片背景同款：仅 patch 路径保留未知兄弟）。
