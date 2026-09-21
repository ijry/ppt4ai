# 带文本的形状几何设计

> 状态：已实现（2026-09-03，`7d449bc`）
> 日期：2026-09-03

## 1. 目标

让带文字的形状在画布上画出自己的几何与填充。这是本会话找到的最大保真缺口：导入任何真实 PPT，除文字以外几乎什么都看不见。

## 2. 探针结果（实测）

一张幻灯片放三个填充过的形状：圆角矩形（`txBody` 存在但空，PowerPoint 的常态写法）、椭圆（带文字 `Label`）、矩形（**完全没有** `txBody`）。

```
el_1: {"kind":"text","text":"","body":{"bodyPr":{"verticalAlign":"middle"},…},
       "fill":{"color":{"type":"srgb","v":"4472C4"}},"stroke":{…"203864"}}     ← preset 没了
el_2: {"kind":"text","text":"Label","body":{…},"fill":{…"ED7D31"}}             ← preset 没了
el_3: {"kind":"shape","preset":"rect","fill":{…"70AD47"}}                      ← 唯一保住几何的
```

**`p:sp` 只要带 `<p:txBody>` 就变成 `kind: 'text'`，`prstGeom` 随之丢弃** —— `parseText` 只看 txBody 是否存在（`importer.ts:709`），不看里面有没有字符，而 **PowerPoint 给每个形状都写 txBody**（哪怕只有 `<a:p><a:endParaRPr/></a:p>`）。所以 `el_3` 那种「无 txBody」的形状在真实文件里几乎不存在。

**第二只鞋**：`fill` 与 `stroke` 确实进了模型，场景图也算出了 `resolvedFillColor`（`scenegraph.ts:277-279`），但**没有任何绘制器读文本节点的这两个字段** —— grep `resolvedFillColor` 只有 `shape-painting.ts:75` 与 `table-painting.ts:57` 两个消费点，`paintTextNode` 只画 run 与 marker。

两者叠起来的净效果：**导入真实 PPT 后，圆角矩形、椭圆、箭头、标注框全部只剩文字，底色与轮廓都不画**。这不是细节偏差，是画布接近空白。

## 3. 关键决策

**决策 1：给 `TextElement` 加可选 `preset`，不合并两种 kind**

```ts
export interface TextElement {
  kind: 'text'
  preset?: PresetGeometry   // 新增：带文字的形状保留自己的几何
  …
}
```

**否决了「把 `ShapeElement` 与 `TextElement` 合并」**：那要动 engine 的每条按 kind 分派的命令、editor 的命中与缩略图、导出的 `p:sp` 分支、以及所有 `kind === 'text'` 的文本编辑入口（`setTextBody`、`TextBoxEditor`、`normalizeTextElement`…）。本项目早就选了「带文字的形状归 text」这条路，加 `preset` 是把那个选择补完整，而不是推翻它。

**否决了「按 txBody 里有没有字符决定 kind」**：那会让同一个形状在用户删完文字时从 text 变成 shape，几何与文本属性在两种形状之间来回搬。判据必须与内容无关。

**决策 2：几何在场景图里合成，`SceneTextNode` 加 `path`**

`createTextNode` 在元素**有 fill 或 stroke 时**才生成路径，preset 缺省按 `rect`（PowerPoint 里一个带底色的文本框就是矩形）。没有填充也没有描边的纯文本不生成路径，避免给绝大多数文本节点挂一份用不到的几何。

这与 group 旋转级联、主题字体解析同一条既有纪律：**模型只存作者写下的东西，派生数据在场景构建期合成**。

**决策 3：`paintTextNode` 先画几何再画文字，复用 shape 那份的顺序**

填充 → 描边 → 文字，与 `paintShapeNode` 的顺序一致。绘制器已经收到 `resolvedFillColor`/`resolvedStrokeColor`，本切片只是让它别再忽略。**缩略图 worker 与表格不受影响**：worker 委托同一个 `paintTextNode`（自动获益），表格走的是 `paintTextLayout`（只画布局，没有节点级填充）。

**决策 4：写回不动，standalone 补一行**

`writeback.ts` 的几何替换只在模型与源不同时才写；导入端如实带上 `roundRect`，两边相等，因此**未编辑的文件逐字节不变**（本切片加一条断言钉住）。

`standalone-xml.ts:185` 现在写着 `const preset = isText ? 'rect' : element.preset` —— 把带文字的形状一律降级成矩形。改成读 `element.preset ?? 'rect'`。

**决策 5：不做 `<p:style>` 样式矩阵**

样式矩阵（`fillRef`/`lnRef` + 主题 `fmtScheme` + `phClr` 代入）是另一条独立缺口：**没有显式 `solidFill`、只靠 `<p:style>` 上色的形状**仍不填充。但那条缺口的前提正是本切片 —— 形状得先会画填充，样式矩阵解析出来的颜色才有地方去。顺序不能颠倒，所以留作下一切片，探针结果已记录在案。

## 4. 契约（增量）

`TextElement` 新增可选 `preset?: PresetGeometry`，进 `validateDocument`（沿用 shape 的预设枚举校验）。

`SceneTextNode` 新增可选 `path?: PathCommand[]`。

`serializeShapeXml` 对文本元素改用 `element.preset ?? 'rect'`。

无签名破坏。

## 5. 测试策略

- **导入**：带 txBody 的形状保留 `preset`（`roundRect`/`ellipse`/`triangle` 各一）；无 `prstGeom` 时不产生该字段；纯文本框（无 fill/stroke）行为不变
- **场景**：有 fill 的文本节点带 `path`，且 preset 缺省为 rect；无 fill 无 stroke 时不带 `path`；`path` 与 shape 节点同 bounds 时逐点相同
- **绘制**：填充 → 描边 → 文字的顺序；无 `path` 时不产生 fill 调用（防回归）
- **往返**：未编辑时源包逐字节不变；standalone 生成的文本元素带正确 `prstGeom` 并能重新导入
- **回归**：现有 1039 项测试 —— 尤其文本绘制与缩略图断言

## 6. 已知限制

- `<p:style>` 样式矩阵仍不读（决策 5），只靠它上色的形状依旧无填充
- 只支持 rect/roundRect/ellipse/triangle 四种预设，其余按 rect 降级（先于本切片的既有限制）
- 自定义几何 `a:custGeom` 仍不读
- 描边宽度不建模，`<a:ln w="12700">` 的宽度在画布上体现不出来
- 文本框的 `a:noFill` 与显式无填充无法区分（模型里都是「没有 fill 字段」）
