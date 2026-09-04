# 形状图片填充设计

> 状态：设计
> 日期：2026-09-04

## 1. 目标

让 `a:blipFill` 作为形状（与带文本的形状）的填充进入模型、画到画布、并从导出端写出。这是填充一侧最后一处**能看见的**缺口 —— 渐变已打通，图案与径向仍受语义阻塞，而图片填充的语义完全确定：`a:blip/@r:embed` → 关系 → 媒体部件 → 资产，与 `p:pic` 走的是同一条已建成的管线。

## 2. 探针结果（实测）

四个同尺寸形状，填充分别为纯色、`a:stretch` 图片、带 `a:srcRect` 的图片、`a:tile` 图片（`picture-fill-probe.test.ts`，已删除）：

```
el_1  : {…,"fill":{"color":{"type":"srgb","v":"4472C4"}},"stroke":{…},"strokeWidth":12700}
el_2  : {…,"stroke":{…},"strokeWidth":12700}
el_3  : {…,"stroke":{…},"strokeWidth":12700}
el_4  : {…,"stroke":{…},"strokeWidth":12700}
assets      : null
adapter puts: []
```

**三个图片填充形状连 `fill` 字段都没有** —— 画布上只剩一圈轮廓。更彻底的是 `assets` 为 `null`、adapter 一次都没被调用：媒体字节根本没进模型的资产空间，所以这不是"渲染没画"，而是"信息在导入期就丢了"，与文本格式那刀同一类。

## 3. 关键决策

**决策 1：不动 `Fill`，图片填充作为元素上的兄弟字段 `pictureFill`**

`Fill.color` 是必填，渐变能进 `Fill` 是因为它有第一个停靠点可以拿来当 `color`（"是文件里的真颜色，不是编造的"）。`a:blipFill` 里**没有任何颜色**，要塞进 `Fill` 就得让 `color` 变可选 —— 而 `Fill` 还同时是 run 颜色、表格单元格填充、幻灯片背景与主题条目的类型，那些位置都不支持图片，放宽等于在八处削弱一条不需要削弱的不变式。

反过来，兄弟字段与 `strokeWidth`/`strokeStyle`/`strokeCap`/`strokeJoin` 同构 —— 它们也都在 `stroke` 旁边而不在 `Fill` 里。

**真正定下这个决策的是写回**：图片留在 `Fill` 之外，图片填充形状的 `element.fill` 仍是 `undefined`，`fillReplacements` 里 `sourceFill(blipFill节点)` 也是 `undefined`，两边相等因此**源 `a:blipFill` 一个字节都不动**。若图片进了 `Fill`，模型侧变成"有填充"而源侧解析不出，任何无关编辑都会把 `a:blipFill` 覆写成 `solidFill` —— 与渐变那刀新增 `sourceFill` 所修掉的正是同一类破坏。

**决策 2：只建模 `a:stretch` 形态，`a:tile` 不建模**

平铺要靠 `tx`/`ty`/`sx`/`sy`/`flip`/`algn` 六个属性决定重复的落点与大小，只记"是平铺"而不记这些会把图案摆错位置。不建模的形态保持导入期丢弃，形状继续不画填充 —— 与"只建模 `a:lin`、`a:path` 保持不可表达"同一条。

**决策 3：`a:srcRect` 一并建模，复用 `ImageCrop` 与 `cropSource`**

裁剪被忽略不是"少画一点"，而是**画错内容**（整张图而不是被裁的那块）。类型（`ImageCrop`）与数学（`image-painting.ts` 的 `cropSource`）都已为 `p:pic` 写好，复用比重写便宜，也避免第二份会漂移的实现 —— `applyMask` 与 `createPresetPath` 各写一份几何已经是仓库里的一处教训。

**决策 4：图片填充压制颜色回退，包括 `fillRef` 样式回退**

场景图现在是 `resolvedFillColor(element.fill) ?? resolveStyleFill(element.styleRef?.fill)`。图片填充形状的 `element.fill` 缺席，于是会回退到样式引用的颜色并画在图片**下面**。半透明 PNG 会因此与一个编造的颜色合成。文件说填充是图片，那就没有颜色 —— 两条回退都跳过。

**解码失败画不出填充，但节点照画。** 图片节点解码失败是整个节点跳过（节点本身就是那张图），而形状的图片只是它的填充，丢了不该连轮廓和文字一起丢。失败按既有 per-node 分类上报 issue（`missing-asset`/`decode-failed`），形状继续画描边与文本。

**决策 5：`a:blip` 的效果与 `rotWithShape` 不建模**

`alphaModFix`/`grayscl`/`duotone` 与 `@rotWithShape` 都是独立一刀。`ImageElement.effects` 已有前两者的模型，接过来不难，但那要连带决定它们在填充上的绘制顺序与 `globalAlpha` 归属，与本刀的"图片进得来、画得出、写得回"不是同一件事。代价写进限制。

**决策 6：`setElementFill` 同时清掉 `pictureFill`**

`setElementFill` 已经存在（工具栏能改填充色）。若不清，给图片填充形状选一个颜色会：模型里两个字段并存 → 画布按决策 4 仍画图片（看起来点了没反应），而写回把 `a:blipFill` 换成 `a:solidFill`（文件却真的变了）。**画布与文件不一致比任何一边错都糟**，所以"选一种填充就替换上一种"由命令维护，这也正是 PowerPoint 的行为。`null`（无填充）同样清掉。

模型不校验"两者不可并存"：手工构造的文档不该因此报错，并存时按决策 4 图片优先，并有测试钉住。

**决策 7：写回只保留与替换，不新增图片填充字节**

源包范围写回能保留既有 `a:blipFill`（决策 1），也能在改成颜色时替换掉它（`fillNodeNames` 本就含 `blipFill`）。但**往既有包里塞一个新的图片填充**需要同时插入媒体部件、关系与 content-type —— 本刀不加"设为图片填充"的命令，因此这条路不可达，不做。无源生成（`createPptx`）反而完整写出：媒体、关系、扩展名声明都复用 `p:pic` 已有的那套。

**决策 8：解码器入参按结构放宽**

`ImageNodeLoader.load` 的参数从 `SceneImageNode` 放宽为 `{ id, assetId, metadata? }`（它本来只读这三项）。缓存以 `assetId` 为键，因此同一张媒体被一个 `p:pic` 和一个形状填充共用时只解码一次。放宽而不是新增第二个 loader。

## 4. 契约（增量）

`@ppt4ai/model`：新增 `PictureFill { assetId: string; sourceCrop?: ImageCrop }`；`ShapeElement`/`TextElement` 新增 `pictureFill?`；校验 `assetId` 非空且存在于 `document.assets`（与 `ImageElement` 同一条规则与同款报错），裁剪范围校验从 `validateImageAppearance` 抽出复用。

`@ppt4ai/pptx-import`：`a:blipFill` 在幻灯片形状循环里解析（那里才有 `slidePath`/`slideRelations`/`entries`），资产按 `stableAssetId` 注册并去重，非位图媒体走既有 `onIssue` 的 `unsupported-media`。

`@ppt4ai/render`：`SceneShapeNode`/`SceneTextNode` 新增 `pictureFill?: ScenePictureFill`（内联 `metadata`，与 `SceneImageNode` 同款），并压制两条颜色回退。

`@ppt4ai/editor`：`paintShapeNode` 与 `paintPathFills` 接受可选 `DecodedImage`，按路径 `clip()` 后 `drawImage`；`cropSource` 导出复用；幻灯片渲染器与缩略图 worker 在绘制前预取形状填充资产。

`@ppt4ai/engine`：`setElementFill` 的提交里一并删除 `pictureFill`。

`@ppt4ai/pptx-export`：`materializeAssets` 收集形状/文本的图片填充资产；`serializeShapeXml` 接受关系 ID 并写 `a:blipFill`（`a:blip` → `a:srcRect` → `a:stretch` 的 ECMA 顺序）；`serializeCrop` 改为接受 `ImageCrop`。

## 5. 测试策略

- **导入**：`a:stretch` 进模型并注册资产；`a:srcRect` 进 `sourceCrop`；`a:tile` 不进模型（字段缺席）；关系缺失/媒体缺失时不进模型；非位图媒体上报 issue；两个形状共用一张媒体只注册一次；组内形状同样生效
- **模型**：`assetId` 为空、资产不存在、裁剪越界各自报错；合法值通过 `validateDocument`
- **场景**：两种节点透传 `pictureFill` 与 `metadata`；有图片填充时 `resolvedFillColor` 缺席（含只有 `fillRef` 的形状）
- **绘制**：裁剪到形状路径后 `drawImage`；`sourceCrop` 走九参数形态且参数按比例；无图片时行为逐字不变；翻转随几何镜像
- **渲染器**：幻灯片渲染器与缩略图 worker 各自预取并画出；解码失败时形状仍画描边并上报 issue
- **命令**：`setElementFill` 清掉 `pictureFill`，一次 undo 同时恢复两者
- **导出**：standalone 写出 `a:blipFill` + 媒体部件 + 关系 + 扩展名声明，重复导出字节一致，可被 `importPptx` 重新读回；写回在无关编辑下保留源 `a:blipFill` 逐字不变；改成颜色时替换该节点
- **回归**：现有 1415 项

## 6. 已知限制

- `a:tile` 平铺不建模（决策 2），仍不画填充
- `a:blip` 的 `alphaModFix`/`grayscl`/`duotone` 与 `@rotWithShape` 不建模（决策 5）
- `a:stretch/a:fillRect` 的四个内缩属性不建模，只按整框拉伸
- 源包写回不能新增图片填充（决策 7），因此也没有"设为图片填充"的命令与控件
- layout/master 占位符（`ElementDefaults`）上的图片填充不建模：那需要各自部件的关系表，与本刀的幻灯片循环不在同一处
- 表格单元格与幻灯片背景的 `a:blipFill` 不建模（`Fill` 保持不变，决策 1）
