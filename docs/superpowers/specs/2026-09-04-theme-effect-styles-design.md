# 主题效果条目与 effectRef 设计

> 状态：已实现（2026-09-04，`5ddd1c6`）
> 日期：2026-09-04

## 1. 目标

让 `a:fmtScheme/a:effectStyleLst` 进入模型，并让 `<p:style><a:effectRef>` 真正生效 —— 靠 PowerPoint 样式库取阴影的形状（而不是自己声明 `a:effectLst` 的）目前仍然画成平的。这是外阴影那一刀留下的分期项，与填充、线条两刀的「先元素、后主题条目」完全同构。

## 2. 探针结果（实测）

主题带三个 `a:effectStyle`（第一个空、第二个 `a:outerShdw` 用具体色、第三个用 `phClr`），形状只有 `<p:style><a:effectRef idx="2">`（`effect-ref-probe.test.ts`，已删除）：

```
theme ids    : ["theme_1"]
formatScheme : {"fillStyles":[…],"lineStyles":[…],"backgroundStyles":[…]}
element      : {…,"styleRef":{"fill":{…},"line":{…},"effect":{"idx":2,"color":{"type":"scheme","v":"accent1"}},"font":{…}}}
```

**`formatScheme` 里没有 effect 这一项** —— 三个条目全被丢掉；而 `styleRef.effect` **存着 `idx:2`**，指向一个模型里不存在的列表。全仓 grep `styleRef.effect` 在渲染与绘制层**零命中**：这个字段此前只为写回而存在。

## 3. 关键决策

**决策 1：条目类型 `OuterShadow | null`，与 `ThemeStyleEntry` 同一条**

```ts
export type ThemeEffectStyleEntry = OuterShadow | null
```

`null` 同时表示两件事：**空的 `a:effectLst`**（Office 主题第一个条目正是空的）和**我们表达不了的效果**（`a:glow`、`a:reflection`、`a:effectDag`）。二者在解析时的结果相同 —— 没有阴影 —— 所以不需要区分；这与填充条目用 `null` 记「渐变/图案/图片」是同一条纪律：**记 `null` 而不是猜**。

**决策 2：`resolveStyleEffect` 做 `phClr` 替换**

Office 的第三个效果条目是 `<a:schemeClr val="phClr"><a:alpha val="40000"/>`。不替换 `phClr` 就解析不出颜色，阴影会整个消失 —— 与渐变条目那刀发现的同一个坑。因此复用既有的 `substitutePlaceholderColor` 与 `styleEntryAt`（`idx="0"` 是「无」、列表 1 基），形状 `effectRef` 自带的颜色作为占位色，条目自己的 transform 叠在其后。

**决策 3：直接 `a:effectLst` 整体胜过 `effectRef`，不做逐属性合并**

这一条**故意与 `a:ln` 不同**。线条那刀做了逐属性回退（直接 `<a:ln>` 只覆盖它声明的那些，宽度仍可来自主题），因为 `a:ln` 的属性是彼此独立的。效果列表不是：`a:effectLst` 是一个整体，源文件写了自己的列表就意味着「用这一份，而不是样式库那一份」。混合两者会造出文件里不存在的第三种效果。

**决策 4：standalone 写出条目，否则同一个包里的 `effectRef` 悬空**

`standalone-xml.ts` 现在写三个空的 `<a:effectStyle><a:effectLst/></a:effectStyle>`，所以无源生成的包里 `effectRef idx="2"` 指向一个空条目 —— 与 `fmtScheme` 四个列表此前写空、导致 `lnRef`/`fillRef`/`bgRef` 全部悬空是同一个 bug 的最后一角。按模型写出，短缺或缺失的条目用空 `a:effectLst` 补到三个（Office 的第一个条目本来就是空的，这不是发明数值）。

**决策 5：主题写回不碰 `a:effectStyleLst`**

与上一刀元素侧同一条理由：模型只表达 `a:outerShdw` 的四项，从模型重写条目会抹掉源文件里的 `a:glow`、`sx`、`algn`。没有命令能改主题效果，因此**保持不碰**，并有测试固定「改主题颜色时 `a:effectStyleLst` 逐字不变」。

## 4. 契约（增量）

`@ppt4ai/model`：新增 `ThemeEffectStyleEntry`；`ThemeFormatScheme` 新增 `effectStyles?`；新增 `resolveStyleEffect(reference, theme, colorMap)`；条目进 `validateDocument`（复用外阴影的校验）。

`@ppt4ai/pptx-import`：`a:effectStyleLst` 的每个 `a:effectStyle` 取其 `a:effectLst/a:outerShdw`，其余记 `null`。

`@ppt4ai/render`：`shapeShadow(element)` = 直接 `shadow` ?? `resolveStyleEffect(styleRef.effect)`，两种节点同款。

`@ppt4ai/pptx-export`：`serializeThemeXml` 按模型写 `a:effectStyleLst`，补齐到三条。

## 5. 测试策略

- **导入**：三条条目分别进模型（空 → `null`、具体色 → 阴影、`phClr` → 阴影）；`a:glow` 条目记 `null`；无 `effectStyleLst` 时字段缺席
- **模型**：`resolveStyleEffect` 对 `idx=0`/越界/`null` 条目返回 `undefined`；`phClr` 用形状的颜色替换并保留 alpha；条目非法值被校验拒绝
- **场景**：只有 `effectRef` 的形状拿到阴影；同时有直接 `a:effectLst` 时直接的胜出；文本节点同款
- **绘制**：不需要新增（阴影从 `SceneShapeNode.shadow` 起就是同一条路）
- **导出**：standalone 写出三条并能重新导入；主题写回改颜色时 `a:effectStyleLst` 逐字不变
- **回归**：现有 1510 项

## 6. 已知限制

- `a:effectDag`（效果图）与 `a:glow`/`a:reflection`/`a:softEdge` 条目仍记 `null`
- 条目里 `a:outerShdw` 的 `sx`/`sy`/`kx`/`ky`/`algn`/`rotWithShape` 与元素侧一样不建模
- 主题效果条目没有命令与面板；写回不触碰它（决策 5）
- `blurRad` → `shadowBlur` 仍是上一刀记下的近似
