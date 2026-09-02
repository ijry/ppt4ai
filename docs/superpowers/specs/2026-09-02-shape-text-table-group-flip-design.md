# Shape / Text / Table / Group 翻转设计

> 状态：已实现（2026-09-02）
> 日期：2026-09-02

## 1. 目标

让 `flipH` / `flipV` 不再是 image 专属：shape、text、table、group 四种 kind 都能导入、渲染、编辑、写回翻转。

这是旋转链路收尾后剩下的两项延期之一（另一项「多选整体旋转」已由 `c75a23e`、`099c9ae` 完成）。此前 5 份设计文档连续把「shape/text 翻转」列为明确延期。

## 2. 当前基础（实测，非推断）

动手前写了探针测试确认缺口真实存在，而非读码推断：

- 导入一个带 `flipH="1" flipV="1"` 的 `p:sp`，回来的 shape **完全没有翻转数据**；`p:graphicFrame` 上的 `flipH="1"` 同样丢失。
- `parseRotation` 会读 `rot`，但翻转属性在 image 路径之外**根本没有被读取**（`parsePictureTransform` 是 image 专用）。

因此这是与 group/`chOff` 同一类的保真缺口：源包里的信息在导入时被静默丢弃。

五层各自的具体缺口：

1. **模型** —— shape/text/table/group 只有裸 `rotation?: number`，没有 `ElementTransform`，翻转无处安放。
2. **导入** —— `parseElement` / `parseTable` / group 分支都不读 `flipH` / `flipV`。
3. **渲染** —— `createShapeNode` / `createTextNode` / `createTableNode` 一律写死 `node.transform = { rotation }`，丢弃其余字段。
4. **绘制** —— `withRotation` 在 `!transform?.rotation` 时直接 early return，且从不施加 scale。**注意这正是我此前作为死代码删掉的翻转分支**（当时 shape/text 确实没有翻转字段），本切片要把它请回来。
5. **写回** —— `rotationReplacements` 只替换 `rot` 属性。

## 3. 关键决策

**决策 1：加裸 `flipH?` / `flipV?` 字段，不迁移到 `ElementTransform`**

四种 kind 各加两个可选布尔字段，紧邻既有的 `rotation`。

替代方案是把 shape/text/table/group 统一到 image 已用的 `ElementTransform`。否决理由与此前两次同一决策一致：那要同时改导入、两条导出路径与校验逻辑，而这些 kind 的 `rotation` 今天就是裸字段——加裸翻转字段与既有形状保持一致，惊讶最小。

代价：同样三个字段散落在四种 kind 上，`ElementTransform` 继续只服务 image。这是自觉接受的模型层不一致。

**决策 2：`flipH="0"` 与属性缺失等价，模型里不存 `false`**

导入只在值为 `1` / `true` 时记录 `true`，否则字段不出现。写回同样只在需要时写 `1`，清除时删属性而非写 `0`。

理由：让「无翻转」在模型里只有一种表示，避免 `false` 与 `undefined` 两种写法在比较、序列化、往返测试里各自开分支。写回侧因此对源包里的 `flipH="0"` **不产生任何改动**（两者都导入为无翻转，不应制造无意义的字节 churn）——有一条测试专门固定这点。

**决策 3：把 `cascadeRotation` 升级为 `cascadeTransform`，而不是并列加一个翻转级联**

`@ppt4ai/geometry` 的 `cascadeRotation(bounds, rotation, ancestors)` 改为 `cascadeTransform(bounds, own, ancestors)`，`own` 是 `{rotation?, flipH?, flipV?}`，`ancestors` 是 `GroupTransform[]`（`{pivot, rotation?, flipH?, flipV?}`），返回 `{bounds, rotation, flipH, flipV}`。

理由：翻转与旋转在同一条祖先链上**交替作用且不可交换**，拆成两个函数就必须在调用方重新交错，那正是最容易出错的地方。合成一个函数后，「内层先动、外层后动」这条既有语义对两种变换同时成立。

组内翻转的数学有三点与旋转不同，都由测试直接固定：

- **后代 bounds 绕组中心轴做镜像**：`flipH` 时 `centre.x → 2*pivot.x - centre.x`。镜像是等距变换，宽高精确不变，与旋转级联的性质一致。
- **后代自身翻转按位异或**：组与后代都翻同一轴时相互抵消（两次绕平行轴的镜像合成为恒等），字段应当消失而非叠加。
- **单轴镜像会反转角度的旋向**：`flipH !== flipV` 时后代的 `rotation` 取负。双轴翻转是点反射、不改变旋向，且它本身等价于半周旋转——由后代自己的两个翻转字段承载，不额外加角度。

每个祖先内部**先镜像后旋转**，与 `a:xfrm` 上属性的读法一致。

**决策 4：翻转只镜像几何，不镜像文本与单元格**

新增 `withFlipAndRotation`，`shape-painting` 切过去；`text-painting` 与 `table-painting` **继续用 `withRotation`**。

理由：PowerPoint 的 Flip 工具翻转对象几何，但形状里的文字仍保持可读——微软文档明确把「镜像文本」列为需要先转成图片才能达到的效果，而非 Flip 的默认行为。所以镜像整块文本会偏离宿主行为。这不是省事，两处 painter 各有一条测试固定「翻转不产生 scale 调用」，并在注释里写明原因。

> 该结论来自微软支持文档（"Rotate or flip a text box, shape, WordArt, or picture" 与 "Mirror image of slide" 的回答：Objects yes, Text no），**本机无 PowerPoint / LibreOffice，未做阅读器实测**。

**决策 5：新增 `toggleElementFlip` 命令，`toggleImageFlip` 原样保留**

沿用 `setElementRotation` 泛化 `setImageRotation` 时的同一形状：新命令按 kind 分派，image 直接委托给既有的 `toggleImageFlip`（落 `transform`），其余 kind 写裸字段。

取消翻转时**删字段而非存 `false`**，与决策 2 及 image 路径的 `normalizeImageTransform` 一致。

**决策 6：group 翻转留在 group 上，由 scene 拍平时级联**

与 group 旋转完全同构：`toggleElementFlip` 只改 group 自己的字段，不动后代；`documentToSceneGraph` 在拍平时把镜像施加到整棵子树。`SceneGroup` 增加 `flipH?` / `flipV?`，供命中测试与宿主消费。

ungroup 的烘焙（`bakedChildChanges`）随之扩展：此前只在有 `rotation` 或 `childSpace` 时才烘焙，现在翻转也是触发条件，否则解组会造成视觉跳变——与当初 `57a9e0f` 修的是同一类问题。

## 4. 契约（增量）

**模型**

```ts
interface ShapeElement { rotation?: number; flipH?: boolean; flipV?: boolean; /* ... */ }
// TextElement / TableElement / GroupElement 同样两个字段
```

`validateDocument` 对非 image 的 `flipH` / `flipV` 校验布尔类型，错误文案 `elements.<id>.flipH must be a boolean`。

**geometry**

```ts
export interface GroupTransform { pivot: GeometryPoint; rotation?: number; flipH?: boolean; flipV?: boolean }
export interface CascadedTransform { bounds: GeometryBounds; rotation: number; flipH: boolean; flipV: boolean }
export function cascadeTransform(
  bounds: GeometryBounds,
  own: ElementTransformValues,
  ancestors: readonly GroupTransform[],
): CascadedTransform
```

`cascadeRotation` 与 `RotationPivot` 被取代（非并存）——仓库内 3 个调用点全部迁移。

**engine**

```ts
{ type: 'toggleElementFlip'; elementId: string; axis: 'horizontal' | 'vertical' }
```

- image 委托 `toggleImageFlip`，落 `transform.flipH` / `transform.flipV`
- 其余 kind 落裸字段，取消时删字段
- 非法 axis 抛 `unsupported element flip axis: <axis>`，元素不存在抛 `element does not exist: <id>`
- 原子性、no-op、undo/redo 沿用既有约定

**editor / playground**

- 工具栏的两个翻转按钮从 `imageTransformEnabled`（image 单选）改为跟随 `selectedRotatableNode`（shape/text/table/image/group 单选）。该 computed 已由旋转切片建立，此处直接复用而非新造判断式。
- 非 image 发新 event `flip-element`；`flip-image` 原样保留，宿主分别路由到 `toggleSelectedImageFlip` 与新增的 `toggleSelectedElementFlip`。
- 新增状态文案 `element-flipped` / `element-rotated`（后者此前 asset-host 已在发送、但两份 locale 里都缺条目，本切片一并补上）。

**pptx-export**

- `rotationReplacements` 升级为 `transformReplacements(xml, sourceElement, element)`，一次处理 `rot` + 两个翻转属性，仍只改 `a:xfrm` / `p:xfrm` 的开标签，保守写回边界未放宽。group 仍走 `grpSpPr` 作用域。
- standalone 侧 `serializeTransformAttributes` 同时服务 `<a:xfrm>`（shape/text）与 `<p:xfrm>`（table）。

## 5. 测试策略

先写测试再实现。新增 3 个测试文件、扩写 8 个：

- **geometry**：`cascade-transform.test.ts` 固定镜像数学（等距、异或抵消、单轴反转旋向、双轴不反转、先镜像后旋转、内层优先）；`cascade.test.ts` 原 10 项旋转断言逐条迁移到新签名，语义不变
- **import**：`flip-import.test.ts` 覆盖四种 kind、单轴/双轴、`flipH="0"` 不入模型、翻转与旋转共存
- **render**：`flip.test.ts` 覆盖透传、组内级联、等值抵消、`SceneGroup` 上报
- **paint**：shape 镜像绕映射后中心、先转后镜、无翻转不产生 scale；text 与 table 固定「不镜像」
- **engine**：裸字段落点、双轴独立、四种 kind、image 走 transform、原子性与 undo/redo；ungroup 烘焙组翻转、抵消后代翻转、单轴反转后代角度
- **export**：源包写回新增/删除/不 churn 三种情形，group 翻转落 `grpSpPr`；standalone 四种 kind 往返

## 6. 已知限制

- **文本不镜像**（决策 4），且该结论来自微软文档而非本机阅读器实测
- ~~**多选整体翻转未做**~~ —— **已在本切片续做完成，见第 7 节**
- 组内翻转的镜像与 canvas 绘制的舍入可能有亚像素差异，与 overlay 旋转的同类限制一致
- 表格单元格覆盖层不随翻转变化（因为表格不镜像，覆盖层与绘制仍然对齐）

## 7. 续做：多选整体翻转

第 6 节原把「多选整体翻转」列为延期，并写「需绕联合中心镜像并重算各元素 bounds」。**动手时否决了自己这句话** —— 那描述的是「镜像整个排布」，会把左边的元素搬到右边去，是伪装成翻转的布局改动。

**决策 7：`flipSelection` 逐元素翻转，不绕联合中心镜像、不移动任何 bounds**

依据是微软文档明确写的：*"When you rotate multiple shapes, they do not rotate as a group, but instead each shape rotates around its own center."* 翻转同属 Arrange > Rotate 菜单，语义一致。**因此 `flipSelection` 与 `rotateSelection` 形状不同**：后者确实绕联合中心公转并移动 bounds（那是我此前实现并测试固定的），前者不动 bounds。这个不对称是有意的，两处注释都写明了。

选中 group 时后代不动，与单元素路径一致 —— 级联已经镜像它们。**同时选中 group 和它自己的后代时后代被跳过**（复用 `selectionRoots`），否则两次翻转相互抵消，看起来像"这个元素没反应"。

**一个探针记录**：我写了 `flip-probe.test.ts` 对比「翻转组」与「翻转组内居中的子元素」，预期两者渲染相同。**未旋转时相同，子元素带旋转时不同**（`rotation` 一个取负一个不取）。查证后确认**这不是 bug**：组绕屏幕对齐的轴镜像，会反转后代角度的旋向；翻转元素自身是在它已旋转的框内镜像，不反转。子元素一旦带角度，两条镜像轴就不再平行，结果本就该分岔。该探针留在仓库里，把这个区别钉成断言，防止后来者把其中一条"修正"成另一条。

**决策 8：旋转按钮同时补上多选路径**

发现旋转手柄早就支持多选（`rotationHandleVisible` 含 `rotatesAsSelection`），但**工具栏的左右旋转按钮仍然只在单选时出现** —— 这是上一个旋转切片的遗漏，不是设计。两种变换现在共用一个 `transformEnabled` 门禁：能拖的选区也能点。多选时旋转按钮发 `rotate-selection`，载荷是**增量**而非绝对角度（与手势路径一致）。

新增 event `flip-selection`，宿主两层转发到 `flipSelection`，状态文案复用 `element-flipped`。

