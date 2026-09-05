# 为继承位置的占位符插入 `a:xfrm`

> 状态：已实现
> 日期：2026-09-05

## 1. 目标

让**移动或缩放一个继承位置的占位符**能写回源包。

## 2. 为什么这刀紧接上一刀

上一刀（`08525c5`）让无 `a:xfrm` 的占位符进模型，并把「改 bounds 写不回去」记为已知限制、理由是「今天这类元素根本不存在，更谈不上移动」。

**那个理由随上一刀本身失效了**：元素现在可见、可选中、可拖动，而拖动**静默不保存**。这不是遗留缺口，是上一刀新引入的一处静默数据丢失——用户拖了、看着动了、存盘后回到原位。因此这刀是上一刀的必要收尾，不是可选增强。

## 3. 现状

`boundsReplacements`（`writeback.ts:204`）第一行取 `sourceBounds(sourceElement)`，随即 `if (!previous || …) return []`。源包没有 `a:xfrm` 时它直接返回空。**这正是上一刀的安全依据**（未编辑时不新建节点），所以不能简单删掉那个提前返回——要区分「没变，不必写」与「变了，得插入」。

`transformReplacements` 同理在 `if (!source) return []` 退出，旋转与翻转也写不出去。

## 4. 关键决策

**决策 1：只在模型 bounds 与继承来的值不同时插入**

判据不是「源包没有 `a:xfrm`」，而是「模型的 bounds 与导入时用的那个值不同」。导入时用的值就是 layout/master 默认值，而写回拿不到那份默认值——**但拿得到等价的东西**：源包没有 `a:xfrm` 意味着导入必然用了继承值，因此若模型 bounds 仍等于继承值则无需插入。

写回无法自己解析 layout，所以改为**由调用方传入**：`exportPptx` 已经有 `document.layouts`/`document.masters`，按占位符查 bounds 与导入端逐字相同（同一条 `layout ?? master` 顺序）。查不到就当作「无继承值」，此时任何 bounds 都算变化，插入。

**决策 2：`a:xfrm` 插在 `p:spPr` 的最前面**

`CT_ShapeProperties` 的 sequence 是 `a:xfrm?` → 几何 → 填充 → `a:ln` → 效果。因此插在开标签之后、第一个子元素之前。

`<p:spPr/>` 自闭合的情形要先展开成一对标签，否则插不进去。

**决策 3：命名空间前缀从兄弟节点取，缺省 `a:`**

`p:spPr` 是 presentation 命名空间，`a:xfrm` 是 drawing 命名空间，因此不能从 `p:spPr` 的名字推。取 `p:spPr` 里任一 drawing 子元素（几何、填充、`a:ln`）的前缀；一个都没有时用 `a:`——与 `serializePresetGeometry` 的 `sourceName ?? 'a:prstGeom'` 同一做法。

**决策 4：旋转与翻转同批处理**

`transformReplacements` 的 `if (!source) return []` 是同一个洞。既然要插入 `a:xfrm`，它的 `rot`/`flipH`/`flipV` 属性一并写出——否则「旋转一个继承位置的占位符」仍然静默丢失，用户看不出这两种编辑有什么区别。

因此插入的是完整的 `<a:xfrm rot=… flipH=… flipV=…><a:off/><a:ext/></a:xfrm>`，由一处生成。

## 5. 契约（增量）

`@ppt4ai/pptx-export`：`boundsReplacements` 与 `transformReplacements` 合并为一处「源包没有 `a:xfrm` 时的插入」分支；新增 `inheritedBoundsFor(document, slide, element)`（与导入端同序查 layout/master 默认值）；`spPr` 自闭合时先展开。

导入、模型、渲染、绘制**不改**。

## 6. 验证

`packages/pptx-export/src/inherited-bounds-writeback.test.ts`（改写其中一条并追加）：

- 未编辑仍字节相同（**上一刀的安全依据不能回退**）
- 移动继承位置的占位符 → `p:spPr` 里出现 `a:xfrm`，`a:off` 是新值
- 插入位置在 `p:spPr` 开标签之后、几何之前（sequence 正确）
- 自闭合的 `<p:spPr/>` 也能插入
- 旋转该占位符 → `a:xfrm` 带 `rot`
- bounds 未变而别处编辑 → 仍不插入 `a:xfrm`
- 前缀跟随兄弟节点（源包用 `x:` 前缀时插入的也是 `x:xfrm`）

## 7. 已知限制

**没有 layout 默认值时任何 bounds 都会触发插入**：查不到继承值就无从比较，此时插入是安全的一侧（宁可写出真实位置，不可静默丢失）。

## 8. 实现记录（2026-09-05）

实现提交 `6cd4937`。按设计执行，两处值得记：

**「未变则不插入」的判据必须同时看旋转与翻转**。第一版只比较 bounds，于是「只旋转、不移动」的编辑仍然静默丢失——测试立刻标红。源包没有 `a:xfrm` 意味着它**既没声明位置也没声明旋转与翻转**，所以模型里任一项非空都算变化。判据改为「bounds 相同 **且** 无旋转无翻转」才提前返回。

这条错误的形状值得注意：设计第 4 节明写了「旋转与翻转同批处理」，实现却只把它落在了**生成**那一半（插入的 `a:xfrm` 带 `rot`），漏在了**判定**那一半。设计说对了、实现只做了一半，靠测试补上。

**上一刀那条钉住缺口的测试第二次发挥作用**。`does not invent a transform when the inherited element moves` 是上一刀刻意留下的，本刀把它翻成 `creates the transform when the inherited element moves`，并追加「未变时仍不插入」一条守住旧的安全性质。两刀之间的交接完全由测试完成，没有依赖散文。
