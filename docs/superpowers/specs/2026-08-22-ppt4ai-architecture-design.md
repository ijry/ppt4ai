# ppt4ai 架构设计总纲

> **状态**：已确认（2026-08-22）
> **类型**：总纲 —— 钉死架构边界、JSON 格式与建设顺序；每个阶段另有独立 spec
> **决策来源**：2026-08-21 ~ 08-22 需求梳理会话，28 条决策逐条确认，见 §8 决策台账

---

## 0. 项目定位与范围

### 0.1 一句话

以**兼容 Microsoft pptx 格式**为目标的 Web 版高性能 PPT 编辑器，原生文件格式为 JSON，以 npm 组件库形态交付。

### 0.2 交付形态

产出 `@ppt4ai/editor`，宿主项目中：

```vue
<Ppt4aiEditor v-model="json" />
```

即可嵌入任意 Vue3 项目。仓库内附 `apps/playground` 完整 demo 站做开发与展示。

**不做**：独立成品站点（自带路由/文件管理/模板库/后端）、绑死某个后台的业务插件、Web Component / iframe 跨框架 SDK。

### 0.3 目标客户端

**现代 Chromium 桌面**（Chrome/Edge 最新两个版本）为唯一主目标。

这不是偷懒，是换取具体能力：`OffscreenCanvas`（worker 缩略图的前提）、worker 作用域内 `FontFace`、`Path2D.isPointInPath`。Firefox/Safari 与移动端编辑均**不在本期范围**。

### 0.4 性能目标

**200 页 / 单页 500 元素**（合计 10 万元素）。

关键认识：同一时刻只有 1 页在编辑画布上，另外 199 页是缩略图 —— **缩略图列表才是性能瓶颈的真正来源**，不是编辑视口。这个判断直接推导出 §3.4 的 worker 缩略图方案。

### 0.5 AI 范围

**本期不实现 AI 功能，但架构必须预留扩展点。** 具体落实为两条硬约束：

1. 文档模型是纯 JSON，可 `structuredClone`，无类实例、无原型链
2. 所有编辑动作走可编程的 command 总线（§1.3），AI 与自动化拿到的是同一套 API，而不是另开后门

满足这两条，后续接入 AI 生成、MCP Server、AI 美化都不需要重构。

### 0.6 多人协同

**本期不实现，但模型层做到 CRDT-ready**（§2.1 扁平存储 + §1.3 patch 历史）。额外成本很小，事后补则要推翻模型。

### 0.7 无障碍

**本期不做。** 纯 Canvas 渲染使无障碍归零，恢复需额外维护一棵 ARIA 镜像树，且极易与 canvas 内容不同步。补偿路径：提供「导出为无障碍 HTML / 大纲」。

### 0.8 服务端依赖边界

**纯前端自足。** pptx 导入导出、图片导出全部在浏览器内完成，开箱不依赖任何服务端。

---

## 1. 总体架构与包结构

### 1.1 一条贯穿全局的原则：模型层用 OOXML 原生单位

这是保真度的地基。参考实现 PPTist 用 `1000 × 562.5` 的 px 逻辑视口，每次 pptx 往返都会有舍入漂移。我们**直接用 OOXML 的原生单位存**：

| 量 | 单位 | 例 |
|---|---|---|
| 坐标 / 尺寸 | **EMU**（914400 / 英寸） | `w: 12192000` = 13.333″（16:9 标准页宽） |
| 字号 | **百分之一磅** | `sz: 1800` = 18pt |
| 旋转 | **六万分之一度** | `rot: 5400000` = 90° |
| 行距 / 缩进 | 百分之一磅 或 千分比 | 对齐 `a:lnSpc` 的 `spcPts` / `spcPct` |

px 只在**渲染那一刻**才出现：`emu → px = emu / 914400 × 96 × zoom`。**模型里永不出现 px。** 这样导入 → 编辑 → 导出的数值链路是无损的。

### 1.2 包结构（pnpm workspace）

分层原则：**headless 核心与 Vue UI 严格隔离**。核心层不 import vue、不碰 DOM（canvas 与文本度量除外），因此能在 node 里跑单测。

```
ppt4ai/
├─ packages/
│  ├─ model/         @ppt4ai/model        JSON Schema、类型、校验、版本迁移、command 定义、patch 生成
│  ├─ geometry/      @ppt4ai/geometry     DrawingML prstGeom/custGeom → Path2D（含 avLst 调整柄）
│  ├─ layout/        @ppt4ai/layout       文本排版引擎：字体度量表、换行、autofit 缩排
│  ├─ text/          @ppt4ai/text         ProseMirror headless + pptx schema/marks + 隐藏 IME 输入桥
│  ├─ render/        @ppt4ai/render       scene/（模型→SceneGraph，纯函数）+ paint/（SceneGraph→Canvas2D）
│  ├─ charts/        @ppt4ai/charts       lyCharts web fork
│  ├─ animate/       @ppt4ai/animate      动画时间轴模型 + 播放引擎
│  ├─ pptx-import/   @ppt4ai/pptx-import  pptxtojson fork
│  ├─ pptx-export/   @ppt4ai/pptx-export  OOXML 写出 + 节点级 splice 回写
│  ├─ engine/        @ppt4ai/engine       文档实例、命令总线、历史、选择、吸附、变换 —— 零 UI
│  ├─ editor/        @ppt4ai/editor       ⭐ 主交付物：Vue3 + element-plus + unocss
│  └─ player/        @ppt4ai/player       放映 / 演讲者视图（可独立引入）
├─ apps/playground/                       demo 站
└─ docs/
```

**为什么这么切**：

- `render` 内部再分 `scene/` 和 `paint/`。SceneGraph 是纯 JSON 中间产物 —— 这让最便宜且最高价值的测试成为可能：**改一行渲染逻辑，SceneGraph 快照 diff 立刻告诉你影响了什么**，不用截图比对。
- `geometry` 独立，因为它同时被 render（绘制）、engine（命中测试）、pptx-import/export（几何编解码）需要，而它本身是纯数据 + 纯函数。
- `engine` / `editor` 的切分是最关键的一刀：所有编辑语义（选择、吸附、变换、历史）在 engine 里，可在 node 中断言；`editor` 只做「把 engine 状态画成 element-plus 面板」。
- `player` 独立可引入 —— 只看不编辑的场景（分享链接、移动端预览）不该背整个编辑器的体积。
- **交互层（变换手柄 / 选择框）在 `engine` 内隔离成界面清楚的模块**，见 §3.8。

### 1.3 命令总线：一条总线兼顾撤销、协同与 AI

CRDT-ready 和「AI 预留扩展点」这两件事**指向同一个设计**：

```
用户交互 ─┐
AI / 脚本 ─┼─→ Command ──→ Engine ──→ 生成 Patch ──→ Document
宿主 API ─┘                              │
                                         ├─→ History（存 patch，不存快照）
                                         └─→ (future) Yjs / 广播
```

所有写操作必须是 command，engine 内部**没有任何绕过总线直接改模型的路径**。收益是三重的：

- **撤销/重做免费** —— patch 可逆
- **协同接入点现成** —— patch 就是待广播的 op
- **AI 与自动化拿到同一套 API** —— 不是另开后门

历史存 patch 而非全量快照：200 页文稿的快照式历史会吃掉几百 MB。

### 1.4 技术栈

- **TypeScript strict** 全程
- **Vitest** 单测 + 快照
- **Playwright** e2e 与视觉回归
- **unocss + element-plus** 按需引入
- **vue-i18n 从第一个 commit 起**，key 用语义化命名（`toolbar.insert.shape`），**不用 hash**

i18n 早做几乎零成本、晚做极痛。PPTist 正是在这里永久缺失 —— 作者两次驳回社区 i18n PR，理由就是后补无法维护；其中一次的具体原因是 PR 用了 hash key。

---

## 2. JSON 文档模型

这是一切的地基，改一次代价最大。

### 2.1 顶层：全部扁平存储

```jsonc
{
  "format": "ppt4ai", "version": 1,     // version 用于迁移
  "id": "dck_7f3a",
  "meta": { "title", "author", "created", "modified", "generator" },
  "page": { "w": 12192000, "h": 6858000 },        // EMU，16:9

  "themes":    { "thm_1": {…} },
  "masters":   { "mst_1": {…} },
  "layouts":   { "lay_1": {…} },
  "slides":    { "sld_1": {…} },
  "elements":  { "el_1":  {…} },        // ★ 所有元素扁平存放，含母版/版式内的
  "slideOrder": ["sld_1", "sld_2"],     // 顺序单独存，重排只动数组
  "sections":  [{ "id", "name", "slideIds" }],
  "assets":    { "ast_1": {…} },
  "timelines": { "sld_1": {…} },        // 动画
  "source":    {…}                      // 原始 pptx 旁挂
}
```

**为什么元素扁平而不嵌套在 slide 里** —— 这是 CRDT-ready 的实质。扁平 map + 有序 id 数组正好对应 `Y.Map` + `Y.Array`，两人改不同元素永不冲突。若嵌套成树，协同就要处理「子树移动」，那是 CRDT 里最难的一类操作。

组合（group）也保持扁平：`type: "group"` 的元素持有 `childIds`，z-order 就是数组顺序。

### 2.2 继承：存 sparse，渲染时 resolve

三级继承是这节的核心。**模型里只存本级显式设置的值**，未设置即继承：

```
resolveElement(el) =
    el 自身显式属性
  ← 版式中同 ph.idx/type 的占位符属性
  ← 母版中同 ph.type 的占位符属性
  ← 母版 txStyles（titleStyle / bodyStyle / otherStyle）
  ← 主题（fontScheme / clrScheme 经 clrMap 映射 / effectScheme）
```

这一个决定同时买下四个能力：

| 能力 | 怎么来的 |
|---|---|
| **换版式** | 改 `slide.layoutId`，未被覆盖的属性自动跟变 |
| **换主题** | 改 `master.themeId`，配色字体全变 |
| **母版编辑器** | 改一处，所有引用页自动更新 |
| **干净导出** | 能区分「显式」与「继承」，不会把继承值硬写进 `<p:sp>` 造成文件膨胀并丢失继承语义 |

### 2.3 颜色不能存 hex —— 否则换主题必然失效

pptx 的颜色有五种来源（`srgbClr` / `schemeClr` / `prstClr` / `sysClr` / `scrgbClr`），且 `schemeClr` 还带变换链：

```jsonc
// 主题色 accent1 + 亮度调整（PowerPoint 里"浅色 40%"就是这个）
"color": { "type": "scheme", "slot": "accent1",
           "mods": [{"t":"lumMod","v":60000}, {"t":"lumOff","v":40000}] }

"color": { "type": "srgb", "v": "4472C4", "alpha": 100000 }
```

渲染时 `resolveColor(color, theme, clrMap) → rgba`。存成 hex 就等于把主题烤死 —— 这也是 PPTist 只有几个固定主题色、做不到真实主题映射的原因。

### 2.4 文本体：结构直接对齐 `a:txBody`

```jsonc
"txBody": {
  "bodyPr": { "anchor": "ctr", "wrap": "square", "vert": "horz",
              "insets": { "l": 91440, "t": 45720, "r": 91440, "b": 45720 },
              "autofit": { "type": "normAutofit", "fontScale": 92500, "lnSpcReduction": 10000 } },
  "paragraphs": [{
    "pPr": { "algn": "ctr", "lvl": 0, "marL": 0, "indent": 0,
             "lnSpc": {"pct": 100000}, "spcBef": {"pts": 0},
             "bullet": { "type": "char", "char": "•", "font": "Arial" } },
    "runs": [
      { "t": "Hello ", "rPr": { "sz": 1800, "b": true, "u": "sng", "spc": 0, "baseline": 0,
                                "latin": "Calibri", "ea": "微软雅黑", "color": {…} } },
      { "type": "br" },
      { "type": "field", "fldType": "slidenum", "t": "3", "rPr": {…} }
    ]
  }]
}
```

两个细节值得指出：

- `rPr` 区分 **`latin` / `ea` / `cs` 三套字体** —— 中英文混排时 PowerPoint 分别取用，这是中文文稿保真的关键
- `runs` 里除文本还有 `br`（换行）和 **`field`**（页码、日期）—— 后者让**自动页码**成为可能，而这正是 PPTist 至今用手写文本框凑的空缺（issue #391）

ProseMirror schema 的映射是直的：`doc → paragraph[] → text + marks`，`rPr` 变 marks，`pPr` 变 paragraph attrs。

### 2.5 无损回写：字节区间替换，而非 XML 树重建

```jsonc
"source": {
  "kind": "pptx", "hash": "sha256-…",
  "bundleKey": "src_bundle_1",          // 原始 zip 全量存在 adapter 里
  "spans": { "el_1": { "part": "ppt/slides/slide1.xml", "start": 1842, "end": 2517 } },
  "partMap": { "sld_1": "ppt/slides/slide1.xml" }
}
```

导出三条路径：

1. **整页未脏** → 原始 part 原样输出。零解析、零风险。
2. **部分元素脏** → 取原始 part **字符串**，按 `spans` 做**字节区间替换**：脏元素区间换成新生成的 XML，其余区间**逐字节保留**。
3. **无 source**（新建文稿）→ 全量生成。

**为什么必须是字节区间而不是 XML 树**：树重建（parse → 改 → serialize）会丢属性顺序、命名空间前缀、自闭合写法、空白。这些语义无关，但会让「未修改内容原样回写」变成一句空话 —— 而且**逐字节 diff 测试就没法做了**。字节区间替换让未改动部分**按构造逐字节相同**，往返测试可以直接断言 `原文件 == 导出文件`。

**可行性已实测确认**（见 §4.1）：需要给 XML 扫描器加节点字节偏移，tokenizer 级别即可，不需要完整 DOM。

### 2.6 不可编辑但必须存活的类型

因为承诺了无损回写，SmartArt、OLE 对象、EMF 图片这些我们**编辑不了但不能弄丢**。schema 里要有「不透明保留」类型：

```jsonc
{ "id": "el_9", "type": "diagram",     // SmartArt
  "xfrm": {…},
  "opaque": true,                       // 结构不可编辑
  "children": ["el_10", "el_11"] }      // 拆出的矢量形状，只读可见
```

**⚠️ 重要修正：SmartArt 走矢量渲染，不走光栅化 fallback。**

初版设计写的是「用 pptx 自带的光栅化图预览」，实测证伪。对 `apache/poi` 的 `SmartArt.pptx` 实测结果：

- fallback 是**独立的 `ppt/diagrams/drawing1.xml` part**
- 内容是 `dsp:sp` + `a:prstGeom` + `a:gradFill` + `dsp:txBody` —— **真正的 DrawingML 矢量形状，`a:blip` 计数为 0**
- **没有 `mc:AlternateContent` 包裹**（20 个 `dgm:relIds` 里 0 个被 MCE 包）

所以 SmartArt **渲染成真实矢量形状**（`dsp:spPr` → `p:spPr` 映射，文本用 `dsp:txXfrm` 定位），清晰度与普通形状一致，只是**结构不可编辑**。

注意：pptxtojson 的 `diagram.js` 已在做这件事，但用的是 `JSON.stringify().replace(/dsp:/g,'p:')` 这种粗暴全文替换 —— **会污染任何含 `dsp:` 的属性值，必须重写。**

### 2.7 版本迁移从第一天就有

`version` 字段 + `migrations/` 目录，每个迁移是 `(doc: vN) => vN+1` 的纯函数，加载时链式跑到最新。

后补迁移机制等于让早期文件永久损坏 —— 这是零成本预防、事后无法弥补的一类事。

### 2.8 资源存储：JSON 存引用 + adapter

JSON 里只存 `assetId` + 元信息（尺寸、mime、原始文件名），二进制走宿主提供的 **资源 adapter**（上传 / 取回）。编辑器自带 **IndexedDB 默认实现**，开箱能跑。

另提供 **`.ppt4ai` zip 打包格式**（JSON + `assets/`）作为自包含交付形态。

**为什么不内联 base64**：体积 +33%，200 页带图文稿容易到几十 MB，解析、diff、历史记录全会被拖垮。

---

## 3. 渲染管线

**架构决策：纯 Canvas2D。** 与 Google Slides、WPS Web 同路。不用 Fabric / Konva 等 canvas 库（理由见 §3.9）。

### 3.1 三段式管线，每段可独立缓存与测试

```
Document (JSON)
   │  resolve()   继承解析（母版→版式→页），带依赖索引与缓存
   ▼
ResolvedSlide
   │  layout()    文本排版：换行、autofit 缩排、行盒定位
   ▼
SceneGraph        ★ 纯 JSON 绘制描述，零 DOM 依赖 —— 快照测试锚点
   │  paint()     Canvas2D 绘制指令
   ▼
Canvas
```

三段都是纯函数。失效是**分段**的：改一个字只失效该元素的 `layout`；换主题失效全部 `resolve`；改缩放只失效 `paint`。

### 3.2 SceneGraph：文本在这一层就已经排好版了

```jsonc
{ "id": "sld_1", "size": { "w": 12192000, "h": 6858000 },
  "nodes": [
    { "kind": "path", "id": "el_1", "z": 0,
      "transform": { "x","y","w","h","rot","flipH","flipV" },
      "path": "M 0 0 L 100 0 …",                    // 已解析几何，直接喂 Path2D
      "fill": { "kind": "gradient", "stops": […], "angle": 5400000 },
      "stroke": { "color": "rgba(…)", "width": 12700, "dash": […] },
      "effects": [{ "kind": "outerShadow", "blur", "dist", "dir", "color" }] },

    { "kind": "textLines", "id": "el_2", "z": 1, "transform": {…}, "clip": {…},
      "lines": [{ "y": 0, "baseline": 14.2,
                  "runs": [{ "x": 0, "text": "Hello", "font": "18px Calibri", "color": "…" }] }] },

    { "kind": "image", "id": "el_3", "assetId": "ast_1", "srcRect": {…}, "filters": […] },
    { "kind": "raster", "id": "el_4", "source": "chart:el_4" }    // 图表产物
  ] }
```

**文本在 SceneGraph 里已是定位好的行盒与 run**，`paint()` 只负责逐 run `fillText`。这是「排版可复现」的实现方式 —— 也是为什么导出的 PNG 和屏幕上一模一样。

### 3.3 分层 canvas + 拖拽提升

```
┌ interaction ─ 选择框、手柄、吸附参考线、框选、光标   ← 高频，独立层，重绘极廉价
├ content     ─ 元素本体                              ← 中频，dirty rect 局部重绘
└ background  ─ 页面背景 + 母版/版式内容                ← 编辑期几乎不重绘
```

拖拽时用**图层提升**：把被拖元素临时移到 interaction 层，`content` 层只在拖拽开始（擦除）和落下（重绘）各画一次。拖动过程中 60fps 只画一个元素 —— 这是 500 元素页面还能跟手的关键。

dirty rect 的包围盒要算上**描边宽度、阴影扩散和旋转后的外接矩形**，否则会留残影。用 R-tree 查询与脏矩形相交的元素，按 z 序重绘。

### 3.4 缩略图 worker

SceneGraph 是纯 JSON —— 这正是它能 `structuredClone` 进 worker 的原因，**架构选择在这里兑现**。

- worker 内 `OffscreenCanvas` 绘制，结果以 `ImageBitmap`（transferable）回传
- 图片资源用 `createImageBitmap` 解码一次，跨 worker 传递零拷贝
- 字体：`self.fonts.add(new FontFace(...))` 在 worker 作用域可用（Chromium-only 的红利之一）
- 优先级队列：可视区缩略图优先，LRU 缓存，页面改动只失效对应页

### 3.5 文本编辑与中文 IME —— 全项目技术风险最高处

编辑态时：

- 一个**零尺寸透明 `contenteditable`** 承接键盘与 IME 事件，**ProseMirror headless** 管模型与事务（它的 DOM view 我们不用）
- 光标（闪烁竖线）和选区高亮**画在 interaction 层**，不是 DOM
- `compositionstart/update/end` 期间，**组词中的未上屏文本要实时排版并绘制** —— 否则用户看不见自己正在打的字
- **关键**：把那个隐藏 `contenteditable` 的屏幕位置**实时贴到光标处**。浏览器的 IME 候选框是相对于焦点元素弹出的 —— 不做这件事，中文候选框会固定飘在页面左上角。**这是 canvas 编辑器最常见的翻车点。**

**光标位置不是额外工作量**：它的难点不在「画一根闪烁竖线」（那是 `fillRect` 加个定时器），而在从 ProseMirror 的文档位置映射到屏幕坐标 —— 而这个映射我们本来就有，因为 SceneGraph 的 `textLines` 已经是定位好的行盒和 run。**光标位置是排版结果的副产品。**

→ 因风险最高，**阶段 0 必须先做 IME 技术预研**，见 §7。

### 3.6 命中测试

R-tree 按包围盒粗筛 → 把鼠标点**逆变换**回元素本地坐标 → `Path2D.isPointInPath` / `isPointInStroke` 精筛（浏览器原生，含奇偶/非零环绕规则，准确且免费）。

文本内命中从 SceneGraph 的行盒 / run 几何二分查找字符位置。

### 3.7 缩放与清晰度

`canvas.width = cssW × devicePixelRatio` + `ctx.setTransform(dpr,0,0,dpr,0,0)`。

**缩放作用在 EMU→px 的换算系数上，不是 CSS transform** —— 任何缩放级别都是清晰重绘，而非位图拉伸。

但手势进行中（滚轮缩放、拖拽画布）允许临时套 CSS transform 做低成本预览，手势结束后再精绘 —— **渐进精化**，兼顾跟手与清晰。

### 3.8 交互层隔离

变换手柄 / 选择框自己写（约一两千行），但在 `engine` 内划成**界面清楚的可替换模块**。它要处理旋转元素的手柄方向、多选包围盒、等比缩放时的文本 autofit 联动 —— 这些都超出通用库的假设，必须自己掌控。隔离的意义是：若实现时发现这块失控，能局部替换而不注入整个渲染栈。

### 3.9 为什么不用 Fabric.js / Konva

**结论：它们能帮的和我们担心的那块，恰好不重叠。**

Fabric（MIT）确实是唯一自带**文本光标渲染**的 canvas 库。但它的光标绑在它自己的文本模型上，而那个模型表达不了 pptx：样式是 per-character 的 `styles[line][char]`，**没有段落级属性**；没有 `autofit`；没有 `latin`/`ea`/`cs` 三套字体分派（中英混排必然错）；没有竖排 CJK；中文 IME 候选框定位在其 issue 区是长期未决项。

**我们既已定用 ProseMirror 管文本模型，Fabric 最大的红利就归零 —— 付了代价却拿不到它唯一独有的东西。**

它索要的代价还砸在核心目标上：

| 代价 | 冲突点 |
|---|---|
| **双模型同步** | 我们的 doc model（sparse 继承、EMU、原始 XML 旁挂）与它的 object model 双向同步 —— 谁是真相来源？撤销撤谁的？ |
| **对象不可 structuredClone** | 带原型链的类实例**传不进 worker**，§3.4 缩略图方案直接失效 |
| **渲染循环不归我们** | `renderAll` 全量重绘；`objectCaching` 是单对象缓存，不是屏幕级 dirty rect |
| **体积** | ~90KB gzip，比自研渲染器还大 |

Konva（MIT，~45KB gzip）有两样正好对上我们设计的东西 —— `Konva.Layer` 就是独立 canvas 元素、`Konva.Transformer` 省下手柄工作量。但它**官方明确不提供文本编辑**，文档直接告诉你自己叠 textarea；双模型同步与 worker 不可传的问题它一样有。

---

## 4. pptx 编解码

### 4.1 导入：fork pptxtojson —— 「留叶换脊」

**唯一且充分的理由**：`shapePath.js` 是 **4637 行（占全库 47%）手工推导的预设几何**。从 ECMA-376 重新推导是几个月工作量，没有捷径。它是 MIT。拿。

#### 预设几何的真实覆盖面

| 项 | 数 |
|---|---|
| switch 里的预设 case 标签 | **187**（另有 5 个是 `shapeSnipRoundRect` 内部的 adjType，不是预设） |
| 其中直接返回矩形的桩 | **13**：`chartPlus` / `chartStar` / `chartX` / `cornerTabs` / `squareTabs` / `plaqueTabs` / `funnel` / `nonIsoscelesTrapezoid` / `folderCorner` / `lineInv` / `flowChartOfflineStorage` / `upDownArrowCallout` / `leftRightCircularArrow` |
| **退化**的 | 9 个连接符里 **7 个塌成一根对角线** `M 0 0 L w h`；`gear6` / `gear9` 渲染完全相同（齿数参数被静默丢弃 —— helper 签名 2 参，调用传了 3 参） |
| **真正可用** | **≈165** |

> 上表的分项计数来自一次源码审计，加总存在 ±1 的出入。**阶段 2 要用一个枚举「已支持预设」的测试把准确数字钉死**，不要在后续文档里继续引用这个约数。

#### 必须第一天修的三件事（不是优化，是崩溃）

1. **46 处 `for (const adj of shapAdjst_ary)` 只有 3 处 `Array.isArray` 守卫。** 而解析器会把单元素数组塌成对象（`readXmlFile.js:37`）—— 所以 `avLst` 里**恰好只有一个 `a:gd` 时抛 TypeError**。而 PowerPoint 常态就是只写用户拖过的那个手柄。**一个只带 `adj2` 的 `rightArrow` 会让整份文件转换失败。**

2. **`shapeArc` 把所有弧线打散成 1°/段的折线。** `smileyFace` 单个形状 ≈1100 段、≈30KB path 字符串。200 页 × 500 元素下是真实的内存问题。修复范围只在 2 个函数。

3. **`custGeom` 四处错**（`shape.js`）：
   - `.shift()` 只保留第一条子路径，**且污染缓存的解析树**
   - `arcTo` 的 X/Y 半径缩放因子写反
   - `arcTo` 忽略当前笔位置，把 `(wR,hR)` 当绝对圆心
   - `a:close` 全部 `order: Infinity`，导致多子路径的 `z` 全堆到末尾

   而且**全库没有 `gdLst` 公式求值器** —— 任何引用 guide 名的 custGeom 直接产出 `"M NaN,NaN"`。

#### 三条硬约束的碰撞情况

| 我们的约束 | 它的现状 | 代价 |
|---|---|---|
| 原始 XML 旁挂 | `readXmlFile.js:46` 读完就丢；txml **没有序列化器、没有节点偏移** | **中**（~1 周） |
| 三级母版模型 + 编辑器 | 扁平 `layoutElements`，输出里**根本没有 layout 身份**；200 页 = 200 份重复拷贝；继承是**即时求值且丢弃来源** | **大**（3-5 周） |
| 纯 Canvas2D | **文本输出是 HTML 字符串**，且每个空格变 `&nbsp;`（`text.js:115`）—— 换行在解析期就被破坏了 | **大**（2-3 周） |

#### 字节区间方案已验证可行

路径很干净 —— 因为所有消费方只通过 `getTextByPathList` 读节点，**给节点加字段不会碰到那 20 个文件**。四步：

1. 给 txml 的 `parseNode` 记 `start` / `end`（~20 行）
2. 保留 part 原始字符串（~5 行）
3. 在 `simplifyLostLess` 挂 `__range`（~10 行）
4. 在 8 个元素产出点切片

**未改动部分按构造逐字节相同。**

#### 一个意外发现：动画导入没有任何现成基础

`animation.js` **只是切页转场**。`p:timing` / `p:anim*` / `p:seq` / `p:par` / `p:bldLst` 全库 **0 命中**。**文件名骗人。** 动画导入得从零写。

#### 存活 vs 重写（约 9768 行）

- **存活 ~5400 行（55%）**：`shapePath.js`(4637)、`color.js`(177)、`schemeColor.js`(55)、`textInsets.js`(64，全库最干净，当范本)、`math.js`(183)、`constants.js`、多数 `utils.js`
- **重写 ~2400 行**：`pptxtojson.js`(1405，脊椎)、`text.js` + `paragraph.js` + `fontStyle.js`(728，改结构化 run 模型)、`readXmlFile.js`(51)、`position.js` / `border.js` / `shadow.js`

**零测试。** 9768 行格式解析器，全库**一个 `try/catch`**。**改之前先补测试，不是可选项。**

### 4.2 导出：不 fork PptxGenJS，当参照物用

它的架构对我们**结构性敌对**：

- `exportPresentation` 是**箭头函数类属性**（`pptxgen.ts:479`），**子类无法覆写**；JSZip 句柄从不暴露
- rollup 入口只导出默认类，`gen-xml` / `gen-charts` 都是**未导出的内部模块** —— 从外面调不到
- `ShapeFillProps.type?: 'none' | 'solid'` —— **渐变在它的类型系统里不可表达**，而这正是我们要超越的第一项
- 单一硬编码 slideMaster；`defineSlideMaster()` 名不副实，它创建的是 **slideLayout**
- ID 分配器**本身就在撞车**：`cNvPr id` 有 `idx+2`、`intTableNum * slideNum + 1`、以及**硬编码的 `id="25"`** 三套算法
- `p:timing` 与 `p:transition` 全库 **0 命中**
- **零测试**（`TESTING.md` 是手工点检清单），最后一个功能版本是 2023-03

#### 但它真正值钱的东西可以只拿不 fork

**① `gen-charts.ts` 的 `createExcelWorksheet`（507 行）—— 唯一值得整体 vendor 的模块。**

它生成图表的**内嵌 .xlsx**（完整的 `[Content_Types]`、`sharedStrings`、`styles`、`sheet1`），让 PowerPoint 的「编辑数据」按钮真的能用。这是 2-3 周工作量，而且是那种**写错了很晚才发现**的东西。

里面还留了个宝贵的负面结论（`:506-510`）：用 `tableParts` 关联 `table1.xml` 只对散点图有效，其它类型会报错 —— 注释原话是「留着这段，免得以后有人愚蠢地再试一次」。

**② Tier-1 的「PowerPoint 静默拒绝」知识 —— 这些猜不出来，只能读**：

| 陷阱 | 位置 |
|---|---|
| `lnSpc` / `paraSpc` / `bullet` 子元素**顺序错了会被静默忽略**（不报错） | `gen-xml.ts:944` |
| 表格边框必须 **L→R→T→B** 顺序，换一行边框就乱 | `:347` |
| 空的 `<a:pPr></a:pPr>` 触发「需要修复」 | `:1287` |
| 空 `txBody` 必须注入 `<a:p><a:endParaRPr/></a:p>` | `:1340` |
| 字体 run 里 **`ea` 必须在 `cs` 之前**，否则东亚文字断 | `:996` |
| `<a:noAutofit/>` 会让 PPT-2013 出错，应该**什么都不写** | `:1104` |
| `spc`（字符间距）单独设置无效，**必须同时关掉 kerning** | `:985` |
| SVG 需要双 rel + `asvg:svgBlip`，ext URI 是 `{96DAC541-…}` | `:576` |
| 媒体 `p14:media` ext URI `{DAA4B4D4-…}`、超链接配色 ext `{A12FA001-…}` | `:660`、`:1015` |

**③ 单位换算与已知良好的样板 XML**：`gen-utils.ts` 全部 275 行照抄（`valToPts` ×12700、`convertRotationDegrees` ×60000）；`theme1.xml`(8247 字符)、`notesMaster1.xml`(7519)、`viewProps.xml` 等样板直接搬。

> **顺带一个发现**：它 package.json 声明的 4 个运行时依赖里，`https` 和 `image-size` 在 src 里 **0 次 import** —— 是幽灵依赖。真实运行时依赖只有 `jszip`。

#### 自研导出器的结构

```
Zip 层      ── 有 source 就先用原始 zip 全部条目播种，再让脏 part 覆盖同名条目
Part 生成器 ── 每种 part 一个纯函数 (model) => xmlString
ID 分配器   ── 导入时保留原 rId/cNvPr id，新建时从安全区间分配
Splice 层   ── §2.5 的字节区间替换
Chart 模块  ── vendor createExcelWorksheet + 自写 lyCharts option → c:chart 映射
```

**四件 PptxGenJS 帮不上、我们必须自己做的**（也正是差异化所在）：

1. 稳定 ID 分配器
2. 真实的 `tableStyles.xml`
3. 真实的三级占位符 / lvl 样式继承
4. `p:timing` 时间轴生成器

### 4.3 EMF / WMF / OLE / 媒体

#### ⚠️ 法律地雷：`emf-to-png` 禁止安装

npm 上的 `emf-to-png` **声明 MIT，实际打包了 925KB 的 wasm** —— 那是 GPL-2.0 的 `libemf2svg` + `libUEMF` 的静态链接产物，不带 GPL 文本。**装了就把 GPL 拖进我们的 Apache-2.0 项目。**

通用教训：**依赖声明的许可证 ≠ 它实际包含的东西。** 带预编译 wasm / native 产物的包尤其要解包查符号。

#### EMF/WMF 的真实分布：它们主要是 OLE 预览，不是图片

统计 Apache POI 语料里全部 43 处 EMF/WMF 引用：

| 数量 | 用途 |
|---|---|
| **22 处** | VML `v:imagedata/@o:relid` —— OLE / 旧版预览 |
| **14 处** | `p:oleObj` → `mc:Fallback` → `p:pic` → `a:blip` |
| **6 处** | 普通 `p:pic` 图片 |

出现率 5-18%（语料相关）。

**关键**：OLE 预览要走**三级降级**：

1. `mc:Fallback` 的 `p:pic`
2. 拿不到 → 用 `spid` 查 `vmlDrawing` 的 `v:imagedata`
3. 再拿不到 → 用 `progId` 生成占位芯片

**跳过第二级会漏掉多数情况（22 vs 14）。**

#### 渲染选型

**`emf-converter`**（Apache-2.0，零依赖，与我们许可证一致，处理 Aldus placeable header，作者同时维护 `pptx-viewer-core`）。

跑在 Worker 里并开启 `maxRecords` / `maxCanvasDimension` 上限 —— **不可信的 metafile 是 DoS 面**。

#### 高价值参考实现

**Apache POI 的 `poi-scratchpad`**：`org.apache.poi.hemf`（111 种 EMF 记录）+ `hemf.record.emfplus`（59 种 EMF+）+ `hwmf`，**全部 Apache-2.0** —— 现存最完整的宽松许可 EMF 实现。日后哪个 JS 解码器有渲染缺口，这是理想的移植目标。

#### 媒体的坑（写进 ID 分配器约束）

- `a:videoFile` 用的是 **`r:link` 而非 `r:embed`**，即使字节是内嵌的
- 必须保留空 `r:id` 的 `ppaction://media` hlinkClick
- 必须保留 `p14:media` 的 ext GUID
- `p:timing` 里有指向 `cNvPr/@id` 的播放控制 —— **动了 ID 分配就会让 PowerPoint 里的播放按钮失效**

---

## 5. 动画

### 5.1 存「预设 + 参数」，不存关键帧

两个库都没有 `p:timing` 的任何基础，导入导出都得从零写。所以模型设计要**为往返服务**：

```jsonc
"timelines": { "sld_1": {
  "mainSeq": [
    { "trigger": "onClick",              // onClick | withPrev | afterPrev
      "items": [
        { "targetId": "el_1", "class": "entrance", "preset": "fade",
          "presetId": 10, "presetSubtype": 0,   // ← pptx 原生预设编号，回写用
          "duration": 500, "delay": 0, "repeat": 1,
          "buildType": "byParagraph",           // 文本按段落逐条出现
          "params": { "direction": "fromBottom" } }
      ] }
  ],
  "interactiveSeq": [ /* 点击对象触发；媒体播放控制在这里 */ ]
} }
```

**为什么不存关键帧**：pptx 的动画本质就是**命名预设**（`p:cTn` 上的 `presetClass` / `presetID` / `presetSubtype`）。存成关键帧曲线就永远回写不回去。

真正的工作量是那张**预设映射表**（PowerPoint 约 40 进入 + 40 退出 + 30 强调）。

### 5.2 播放引擎

因为渲染在 canvas 上，**CSS 动画和 Web Animations API 都用不了**（它们只动 DOM）。所以是 `rAF` + 缓动函数，产出一份**逐元素的 transform / opacity 覆盖层**喂给 `paint()`。

动画状态只是 SceneGraph 之上的一层 override，**不污染文档模型**。

> 为什么不能学 PPTist：它用 **animate.css**（给 DOM 元素挂 CSS class）。我们既做不到，也不该做 —— animate.css 的动画名和 pptx 预设**没有对应关系**，用了就等于放弃动画往返。

---

## 6. 测试策略

### 6.1 五层

| 层 | 手段 | 覆盖 |
|---|---|---|
| 单元 | Vitest | model 校验/迁移、geometry 路径、layout 换行/autofit、color resolve、继承 resolve |
| **SceneGraph 快照** | Vitest 快照 | 每个 fixture → SceneGraph JSON。**改一行渲染逻辑立刻看到影响面** —— 最便宜的高价值测试 |
| 视觉回归 | Playwright | SceneGraph → canvas → PNG 像素 diff。基线**必须在 CI 固定容器里生成**（字体栅格化跨机器有微差） |
| **pptx 无损回写** | 逐字节断言 | 导入 → 不做任何编辑 → 导出 → **`原文件 == 导出文件`**。最强的保真测试，而 §2.5 字节区间方案让它成为可能 —— 换成 XML 树重建就只能做模糊比对 |
| 性能基准 | CI 记录趋势 | 200 页 × 500 元素合成文稿：首屏时间、拖拽帧率、缩略图全量生成耗时。**不进 CI 的性能指标会悄悄退化** |

另有**语义往返**：导入 → 导出 → 再导入，两次 model 归一化后应 deep equal。

### 6.2 测试语料

| 来源 | 许可证 |
|---|---|
| Apache POI `test-data/slideshow` | Apache-2.0 |
| LibreOffice `sd/qa/unit/data/pptx` | MPL-2.0 |
| python-pptx `test_files` | MIT |

**要在 `THIRD-PARTY` 里声明来源。**

### 6.3 一件自动化不了的事

**「PowerPoint 能不能正常打开」。** 需要人工检查清单 + 一批黄金样本，每次动导出器都过一遍。

这个**诚实地写进流程，不假装能自动化**。

---

## 7. 路线图

pptx 导入被**提前**了，理由值得说明：

- 导入器可以**完全 headless 测试**（断言 JSON 输出），不依赖渲染器
- 「能打开真实 pptx 并正确显示」比「能显示我们手写的 JSON」是**强得多的里程碑**，而且它**前置了保真风险** —— 真实文稿里的渐变、嵌套组、奇怪几何会立刻暴露渲染器的缺口，而手写 fixture 永远暴露不了

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **0** | 工程骨架 + **IME 技术预研** | pnpm build 全绿；一个最小 demo 证明「canvas 自绘光标 + 隐藏 contenteditable + 中文 IME 候选框跟随」可行 |
| **1** | model + geometry + render | 加载 JSON → canvas 正确渲染；SceneGraph 快照测试建立 |
| **2** | pptx 导入（至可渲染） | 打开真实 pptx 并正确显示；三级母版继承生效 |
| **3** | engine 编辑交互 | 选择/变换/吸附/历史/z序/组合，全部可在 node 里断言 |
| **4** | 文本（layout + ProseMirror + IME） | 中英混排、autofit、项目符号、竖排；换行位置与 PowerPoint 一致 |
| **5** | editor UI 外壳 + i18n | element-plus 面板体系；zh-CN / en-US 双语 |
| **6** | pptx 导出（含无损回写） | **逐字节往返测试通过**；PowerPoint 打开无修复提示 |
| **7** | 表格 + 图片处理 | 合并单元格、真实 `tableStyles.xml`、裁剪/滤镜 |
| **8** | 图表（lyCharts fork） | 8 种图表可编辑数据；⚠️ pptx 图表覆盖面受 lyCharts 追赶进度限制，见 §9 |
| **9** | 母版/版式编辑器 | 改母版所有引用页自动更新；换主题换版式生效 |
| **10** | 动画 | 三类动画 + 触发时序 + 切页；**动画能导出到 pptx**（PPTist 做不到的） |
| **11** | player 放映/演讲者视图 | 独立引入不背编辑器体积；备注、画笔、计时 |
| **12** | 打磨 | 性能达标、EMF/OLE 三级降级、SmartArt 矢量渲染 |

**阶段 0 的 IME 预研是硬性前置**：它是全项目**技术风险最高**的一块，而且如果走不通，整个纯 Canvas 架构都要重新考虑 —— **那种事必须在写几万行代码之前发现，不是之后。**

---

## 8. 决策台账

28 条决策，全部于 2026-08-22 确认。

- **★** = 用户选择了**与建议不同**的方案
- **▲** = 结论**与用户早先的口头意向相反**，已单独拍板确认

| # | 决策 | 理由 / 代价 |
|---|---|---|
| 1 | 交付形态：npm 组件库 + demo 站 | 对外复用性最强，最容易做单元/e2e 测试 |
| 2 | AI 本期不做，只留扩展点 | 先把编辑器和 pptx 兼容做扎实；纯 JSON + command 总线保证后续无需重构 |
| 3 | ★ 先出总纲，再分阶段细化 | 先把 11 个子系统的边界和接口钉死；本文即总纲 |
| 4 | 性能目标 200 页 / 500 元素 | 判定渲染架构；推导出 worker 缩略图 |
| 5 | pptx 保真：原始 XML 旁挂，无损回写 | 保真度越级领先；代价是模型变重、存储需带附件 |
| 6 | 客户端：仅现代 Chromium 桌面 | 换取 OffscreenCanvas / worker FontFace / Path2D |
| 7 | 协同：不实现，但 CRDT-ready | 额外成本很小，事后补要推翻模型 |
| 8 | 富文本内核：ProseMirror + pptx schema | 白拾 IME/composition/selection 映射；关掉其 history 改用统一 command 总线 |
| 9 | 文本引擎建在 ppt4ai 里 | lyEditor 实测是空骨架（957 行、无 slate 依赖、无构建系统），「适配」等于从零建 |
| 10 | 资源：JSON 存引用 + adapter | 体积可控、能流式加载；自带 IndexedDB 默认实现 |
| 11 | ★ 完整三级模型 **+ 母版编辑器** | 保真度和专业度最高；母版编辑器独立成阶段 9 |
| 12 | 字体：内置度量表 + web font 渲染 | 排版结果与 PowerPoint 一致，且不背嵌入字体的授权风险 |
| 13 | ★ 渲染架构：**纯 Canvas** | 与 Google Slides / WPS Web 同路；导出与屏显同源必然一致。硬成本：光标/选区/命中测试全自绘 |
| 14 | 缩略图：Worker + OffscreenCanvas | 不阻塞编辑，200 页能撑 |
| 15 | 文本输入：隐藏 contenteditable + ProseMirror headless | 一致性最好；IME 候选框必须贴到光标处 |
| 16 | 绘制 API：Canvas2D | 原生字形栅格化清晰度最好；Path2D/渐变/阴影/裁剪全内置；支持 OffscreenCanvas |
| 17 | 无障碍：本期不做 | 补偿路径是导出无障碍 HTML/大纲 |
| 18 | ★ 图表：**移植 lyCharts**（非 ECharts） | 自控全栈、体积小 ~30KB。**已知代价：pptx 图表覆盖面需自追 2-4 个月**，见 §9 |
| 19 | lyCharts 的 4 个 bug 开独立任务去原仓库修 | 单例串扰、grid 单调缩小、33 处样式静默失效、arcTo 圆角柱报错 —— 在 uni-app 端也是真 bug，不占本项目工期 |
| 20 | ★ lyCharts 代码直接 fork 进 ppt4ai | 成为 `@ppt4ai/charts`，自由改造不受 uni-app 约束。代价：分叉维护税 |
| 21 | i18n 从第一个 commit 起，语义化 key | 早做零成本、晚做极痛（PPTist 的反面教材） |
| 22 | 后端：纯前端自足 | 开箱不依赖服务端 |
| 23 | §1 总体架构确认 | EMU 单位、12 包切分、SceneGraph 中间层、命令总线 |
| 24 | §2 JSON 文档模型确认 | 扁平存储、sparse+resolve、颜色不存 hex、字节区间回写、版本迁移 |
| 25 | 不用 canvas 库，自建 | 保留完整模型主权与渲染控制权，worker 缩略图方案成立；光标位置是排版结果的副产物 |
| 26 | ▲ 导出：**不 fork PptxGenJS**，自写 + 战术性 vendor | 其架构结构性敌对（不可覆写、渐变类型不可表达、ID 分配器自撞）。只 vendor `createExcelWorksheet`(507行) + `gen-utils.ts`(275行) + 样板 XML |
| 27 | 导入：确认 fork pptxtojson，「留叶换脊」 | 存活 ~5400 行（以 shapePath.js 为主），重写 ~2400 行脊椎。先补测试 |
| 28 | §5 动画/测试/路线图确认 | 动画存预设+参数、五层测试、导入提前到阶段 2、阶段 0 做 IME 预研 |

### 8.1 会话中被证伪并修正的三条

| 原判断 | 实测结论 |
|---|---|
| SmartArt 用 pptx 自带光栅化图预览 | **错**。fallback 是 `ppt/diagrams/drawing1.xml` 的真实 DrawingML 矢量形状（`a:blip` 计数 0），应矢量渲染。见 §2.6 |
| 纯 Canvas 让 lyCharts 移植价值上升 | **站不住**。ECharts 同样有 canvas 渲染器；导出保真的关键在 option ↔ chart XML 映射精度，不在渲染器基质 |
| pptxtojson 的 `animation.js` 能复用 | **文件名骗人**。它只是切页转场，`p:timing` 全库 0 命中 |

---

## 9. 已知风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| **canvas 自绘光标 + 中文 IME** | 🔴 最高 | 阶段 0 强制技术预研。若走不通，纯 Canvas 架构需重新考虑 |
| **图表 pptx 覆盖面**（决策 18 的已知代价） | 🔴 高 | lyCharts 需从零补：percentStacked、堆叠折线/面积、横向条形、次数值轴、`c:numFmt`、完整 `dLbls`、对数/日期轴、组合图、可点击图例、`option.color` 全局调色板、气泡图、图片导出。**每一项 ECharts 都现成有。预估 2-4 个月**，如实记录在案 |
| pptxtojson 三级母版改造 | 🟠 中高 | 3-5 周；扁平 `layoutElements` 无 layout 身份，继承即时求值且丢弃来源 |
| pptxtojson 零测试 | 🟠 中高 | 改之前先补测试，非可选项 |
| PowerPoint 静默拒绝类 bug | 🟠 中 | §4.2 的 Tier-1 陷阱表 + 黄金样本人工检查清单 |
| 不可信 metafile 的 DoS 面 | 🟡 中低 | EMF 解码跑 Worker + `maxRecords` / `maxCanvasDimension` 上限 |
| 视觉回归基线跨机器漂移 | 🟡 低 | 基线只在 CI 固定容器生成 |

---

## 10. 第三方许可证合规

本项目 **Apache-2.0**。

### 10.1 硬性纪律：PPTist

PPTist 是 **AGPL-3.0**（不是 GPL）—— AGPL 是**网络传染**：即使只提供 SaaS 服务而不分发代码，也触发开源义务。作者同时销售商业授权，并在 `doc/Blacklist.md` 里公开点名侵权公司。

**纪律：绝不读、绝不移植、绝不派生 `src/` 下任何代码。** 仅参考其 README、`doc/` 与 GitHub issues 作为功能需求对照。

### 10.2 禁止清单

| 包 | 问题 |
|---|---|
| `emf-to-png` | 声明 MIT，实际打包 GPL-2.0 的 `libemf2svg` + `libUEMF` wasm 产物。**禁装** |

### 10.3 引入清单（需在 `THIRD-PARTY` 声明）

| 来源 | 许可证 | 用途 |
|---|---|---|
| pptxtojson (fork) | MIT | pptx 导入内核 |
| PptxGenJS (部分 vendor) | MIT | `createExcelWorksheet` + `gen-utils.ts` + 样板 XML |
| lyCharts (fork) | 自有 | `@ppt4ai/charts` |
| ProseMirror | MIT | 文本模型与输入管线 |
| emf-converter | Apache-2.0 | EMF/WMF 渲染 |
| jszip | MIT / GPLv3 双许可（取 MIT） | zip 读写 |
| Apache POI test-data | Apache-2.0 | 测试语料 |
| LibreOffice pptx 语料 | MPL-2.0 | 测试语料 |
| python-pptx test_files | MIT | 测试语料 |

---

## 11. 下一步

1. 本文档由用户 review
2. review 通过后，用 **writing-plans** 技能为**阶段 0**（工程骨架 + IME 技术预研）产出实施计划
3. 实施进展同步记录在仓库根目录 [`进度.md`](../../../进度.md)
