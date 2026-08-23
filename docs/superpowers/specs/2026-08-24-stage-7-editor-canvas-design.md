# 阶段 7 主编辑器单页画布宿主设计

## 目标

把现有 headless SceneGraph 和各类 painter 接入 `@ppt4ai/editor` 的真实单页画布，使 Playground 首屏能够显示一张 PPT 页面，并支持点击节点选中、选中边框和八个缩放控制点。这个切片只建立可视宿主和选择入口，不实现拖拽、缩放变换、文本编辑或多页导航。

## 背景与边界

当前 `PptEditor.vue` 只有 UnoCSS 工具栏和插槽，Playground 左侧也只显示占位文字；`@ppt4ai/render` 已能从文档生成包含 shape、text、table、image 的 JSON-safe `SceneGraph`，`@ppt4ai/editor` 已有 shape/text/table painter、异步图片 Canvas renderer 和 `SelectionOverlay`。本切片负责把这些能力组合成页面级宿主，不把 DOM 或 Vue 依赖引入 model、render、engine。

明确包含：

- 单个 `SceneGraph` 页面在高 DPI Canvas 上绘制，页面尺寸按 EMU 转换为 CSS 像素并保留 `zoom`。
- shape、text、table 按 `scene.nodes` 原始顺序绘制；image 复用 `createImageCanvasRenderer` 的 adapter、缓存和失败隔离。
- Canvas 尺寸、CSS 尺寸、清屏、过期异步渲染抑制和 dispose 由 Vue 宿主管理。
- 点击 Canvas 时把 CSS 坐标转换为页面 EMU，按反向节点顺序做 bounds 命中测试，命中最上层节点后发出 `select`；空白点击发出空选择。
- `PptEditor` 在收到选区和节点 bounds 后显示现有 `SelectionOverlay`，激活节点有边框和八个控制点。
- Playground 以现有 demo 文档生成真实 SceneGraph，保留现有资产库和本地图片上传流程。

明确不包含：

- pointer capture、移动、resize 命令和吸附。
- 文本 caret/IME、表格单元格编辑、双击编辑。
- 多页模型、页面缩略图、滚动工作区和页面切换。
- group 递归命中/绘制、chart 绘制、渐变/阴影和浏览器字体嵌入。

## 方案

新增纯 TypeScript 的页面渲染协调器 `createSlideCanvasRenderer`，输入 `SceneGraph`、Canvas 2D context、`AssetAdapter` 和 viewport，内部按节点类型调用既有 painter：shape 使用 `paintShapeNode`，text 使用 `paintTextNode`，table 使用 `paintTableNode`，image 复用现有图片 renderer 的资源加载缓存和 `paintImageNode`。协调器返回 clone-safe 的 `drawnNodeIds`、`skippedNodeIds` 和逐节点 issue；单节点失败不会阻止后续节点。

为避免重复实现图片解码缓存，图片 renderer 抽出可复用的加载/绘制内部能力；独立 `ImageCanvas` 仍使用其现有清屏入口，页面协调器则由自己清屏并在 `scene.nodes` 循环中调用该共享能力，避免图片 renderer 再次重置 Canvas 或打乱节点顺序。所有 painter 共享同一 EMU-to-CSS mapping，Canvas backing scale 只设置一次。

新增 `SlideCanvas.vue` 作为纯 DOM 宿主：监听 `scene`、`zoom`、`devicePixelRatio` 和 `adapter`，每次变更取消上一轮 render，重置 canvas 尺寸并调用协调器；组件销毁时取消请求并 dispose。组件不调用 engine，只通过 `select` 事件向上报告节点 ID 或 `undefined`。

`PptEditor.vue` 扩展为受控组件，接收 `scene`、`adapter`、`selection` 和 `zoom`，把 `SlideCanvas` 放入现有画布区域，并用 `SelectionOverlay` 根据选中节点 bounds 渲染控制框。选择框的尺寸通过同一 viewport 映射到 CSS 坐标，确保 Canvas、命中测试和控制点没有比例漂移。

Playground 宿主在测试中构造最小真实文档和 `documentToSceneGraph`，将 engine snapshot 的 selection 映射为 PptEditor props；Canvas 的点击事件调用 engine 的 `select` command 后刷新 snapshot。已有资产库、上传 UI 和 Thumbnail smoke 保持不变。

## 坐标与绘制规则

- 页面单位仍为 EMU；CSS 页面宽高为 `page / (914400 / 96) * zoom`。
- Canvas backing width/height 为 CSS 尺寸乘 `devicePixelRatio` 并取整；绘制 context 使用一次 `devicePixelRatio * 96 / 914400 * zoom` 的 transform。
- 命中测试把 `clientX/clientY` 减去 Canvas `getBoundingClientRect()` 左上角，再除以 `zoom * 96 / 914400` 转为页面 EMU。
- 仅对有 bounds 的 shape、text、table、image 做矩形命中；节点按 `scene.nodes` 的后序检查，首个命中者为顶层目标。
- 页面背景由宿主清空后的白色页面呈现；背景填充不伪装成 SceneGraph 节点，也不参与选中。

## 错误与生命周期

无效 scene、Canvas context 缺失或单节点 painter 抛错只产生结构化 issue，不让 Vue 响应式回调抛出未处理异常。异步 image load 结束后必须检查当前 request token；过期结果只关闭资源并丢弃，不覆盖最新页面。组件卸载后不再更新 ref 或发出 render 事件。命中测试只依赖 clone-safe scene，不读取 engine 内部状态。

## 测试验收

- 页面协调器测试 shape/text/table/image 的绘制顺序、统一 mapping、单节点失败隔离和结构化结果。
- `SlideCanvas` 测试高 DPI backing 尺寸、scene 更新取消旧请求、点击坐标和 `select` 事件、卸载不更新。
- `PptEditor` 测试选中节点边框及八个控制点可见、空选区不显示控制点。
- Playground 测试真实 demo SceneGraph 出现在页面区域，点击节点更新 `selected-element` 和 undo depth 不变；已有上传和资产库测试继续通过。
- 完成边界检查、全量测试、递归类型检查、构建和 `git diff --check`；继续确认运行时依赖只包含 Vue、Vue-I18n 和 UnoCSS，不引入 Element Plus。

## 后续切片

画布切片完成后，再分别实现：画布 pointer capture + engine move/resize、文本/表格双击编辑接入、单页滚动与多页导航、group 递归绘制和命中、拖拽/剪贴板资产输入。每个切片保持单独测试和提交。
