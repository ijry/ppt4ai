# 产品级编辑器 UI 外壳设计

> 状态：设计已批准，待实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标与范围

把 `apps/playground` 从开发测试台升级为**有设计的产品级 PPT 编辑器 UI**。采用经典 PPT 布局（顶栏 + 左幻灯片导航 + 中画布舞台 + 右随选属性面板），一次性交付完整外壳并接好现有能力。

- **复用**：`@ppt4ai/editor` 的building-block 组件（`PptEditor`/`SlideCanvas`/`ThumbnailCanvas`/`ThemePanel`/`SlideBackgroundPanel`/`AssetLibrary`/各上下文工具栏）与 `presentation-host` 的全部操作。状态逻辑零重写。
- **落点**：在 `apps/playground` 内搭产品外壳，复用其 host 与 vite；测试台移到 `#dev`、动画 demo 留 `#animation`。
- **明确分期**：AI 生成是**独立的第二个子系统**，单独 spec/计划，本设计不含（见 §9）。

## 2. 做法（方案 A：在 PptEditor 外套产品外壳）

`PptEditor` 已封装最难的交互（画布 + 选择/拖拽/缩放/旋转 + 文本/表格编辑 + 上下文工具栏）。因此产品化 = **围绕它做 chrome**，而非重建交互。

- **A（采用）**：复用 `PptEditor` 当画布舞台；新增 app 级顶栏/左导航/右属性面板 + 设计系统；给 `PptEditor` 加一个 prop 关掉自带对象工具栏，让产品顶栏接管那批动作。风险最低。
- **B（否决）**：在 app 里直接拼 `SlideCanvas`+overlay，重写已封装的交互编排，重复高风险。
- **C（否决）**：把 `PptEditor` 长成产品外壳放进 editor 包，混淆"可复用库"与"产品 app"职责。

## 3. 架构与数据流

- **四区 CSS grid**：顶 `AppToolbar`（通栏）· 左 `SlideNavigator` · 中 `CanvasStage` · 右 `Inspector`；左右可折叠。
- **组件树**（单一数据源 = `presentation-host` 快照，`shallowRef`）：
  ```
  EditorApp.vue      持有 host + 快照;向下传 snapshot 和 actions 门面
  ├─ AppToolbar      撤销/重做·复制/粘贴·新增页·插入·对象组·缩放   → host
  ├─ SlideNavigator  ThumbnailCanvas 列表 + 增/复制/删/排序          → host
  ├─ CanvasStage     居中+缩放地包住 PptEditor(舞台+上下文编辑)     → host
  └─ Inspector       随选切换:幻灯片/对象,复用现有面板 + 几何字段   → host
  ```
- **数据流**：所有动作 → `host.method()` → 新快照 → 重渲染。沿用 App.vue 现有模式，不引入新状态机。
- **hash 路由**：`#dev` 旧测试台、`#animation` 动画 demo、其余进 `EditorApp`。

## 4. 设计系统

- **Design tokens**（`uno.config.ts` 扩 theme，与 editor 包 slate 系对齐）：表面 `bg`/`surface`/`surface-2`/`border`；文本 `text`/`muted`；主色 `primary`(blue-600)+`primary-hover`；危险 `danger`；圆角 4/6/8；两级阴影；z 层次（画布<overlay<面板<顶栏<浮层<弹窗）。**仅浅色**，命名留深色空间。
- **图标**：`lucide-vue-next`（MIT，锁版本）。
- **UI 原语**（`apps/playground/src/ui/`，克制）：`Button`/`IconButton`/`Toolbar`+`ToolbarGroup`/`Panel`+`PanelSection`/`Field`/`Select`/`Divider`，全部吃 token；内置 `focus-visible` 环与 aria。

## 5. 四个区

**AppToolbar**：历史（`undo`/`redo`，按 `presentationHistory` 深度禁用）· 剪贴板（`copySelected`/`paste`，按 `clipboard`+选择禁用）· 插入（形状=PptEditor insert；图片=`insertAsset`/`uploadAndInsert`；文本/表格若 host 无则待补）· 对象组（选中才亮：`groupSelected`/`ungroupSelected`/`rotateSelection`/`flipSelection`）· 缩放（CanvasStage 持有）。

**SlideNavigator**：纵向 `ThumbnailCanvas` 列表，当前页高亮，点击 `selectSlide`；悬停出复制/删除；顶部新增页。排序本期用 `moveSlide` 上/下一步 + 拖拽映射为逐步移动；拖到任意位需新 host 方法，列后续。

**CanvasStage**：`PptEditor` 居中于带底色可缩放区，默认适应宽度；下传 scene/adapter/选择/textBodies/字体/zoom，上转 select/move/resize/rotate/文本·表格事件给 host。文本/形状/表格上下文工具栏保留 PptEditor 浮动那套（有意的浮动模式，配色对齐即可）。

**Inspector**（随选切换，复用面板）：未选/幻灯片级 = 背景(`SlideBackgroundPanel`)+版式(`setSlideLayout`)+主题(`ThemePanel`)+素材(`AssetLibrary`)；选中对象 = 几何 x/y/w/h+旋转(`resizeElement`/`rotateSelectedElement`)。填充/描边/文本/表格格式本期仍走 PptEditor 浮动工具栏；"全部收进右侧停靠栏"列后续。

## 6. 两处小改动

- `PptEditor` 加 `showObjectToolbar?: boolean`（默认 true，向后兼容），app 提供顶栏时置 false；加一条测试。
- 新增 `lucide-vue-next`（MIT，锁版本）到 playground。
- token 与 PptEditor 现有 slate 配色对齐，免深改。

## 7. 测试策略

- **纯逻辑单测**：顶栏启用/禁用、Inspector 上下文选择、缩放档位 → 从快照推导的纯函数/composable，headless。
- **UI 原语**：happy-dom 挂载测（渲染/emit/disabled）。
- **区组件**：happy-dom + stub host，断言交互调对 host 方法、反映快照（禁用态、当前页高亮、Inspector 随选切换）。
- **e2e 冒烟**（Playwright，复用现有 e2e）：载入→新增页→选中→Inspector 切换→撤销/重做；构建中用 Playwright 截图核验。

## 8. 构建顺序

1. 设计系统（token + `ui/` 原语 + lucide）
2. 壳骨架（`EditorApp.vue` 四区 + hash 路由 + 快照下传）
3. 左导航（选/增/复制/删/排序）
4. 顶栏（历史/剪贴板/插入/对象/缩放）+ PptEditor prop
5. 画布舞台（居中+缩放，包 PptEditor，转发事件）
6. Inspector（随选切换；复用面板 + 几何字段）
7. 打磨 + e2e 冒烟 + 截图核验

## 9. 明确不在本期（后续/独立 spec）

- **AI 生成**（大纲流式 + 一页页建立 + 现有渲染预览）——独立子系统，单独 spec/计划。厂商可插拔（OpenAI API / Claude 等）；`openai/codex` 是终端编码 agent、非内容生成内核，不作为生成核心。
- 把填充/描边/文本/表格格式全部从 PptEditor 抽出、停靠进右侧 Inspector（需把工具栏状态从 PptEditor 里提出，属重构）。
- 拖拽到任意位排序（需新 host 方法）；文本/表格插入若 host 未提供。
- 深色主题。

## 10. 验收契约

- 打开 app（非 `#dev`/`#animation`）呈现四区经典 PPT 布局，视觉为一套设计系统（非裸工具类）。
- 左导航可选/增/复制/删/上下移；顶栏历史·剪贴板·插入·对象·缩放可用且禁用态正确；画布居中可缩放并可编辑；右属性面板随选在幻灯片级/对象级间切换并复用现有面板。
- 全仓 `vitest run` 与各包 `typecheck` 退出码 0；playground `vite build` 通过；新增区组件/原语/纯逻辑均有测试。

