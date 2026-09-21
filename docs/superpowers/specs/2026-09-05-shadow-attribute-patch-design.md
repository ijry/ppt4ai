# 替换阴影时保留未建模的属性

> 状态：已实现
> 日期：2026-09-05

## 1. 目标

改一个来自源包的阴影时，不再连带丢掉 `sx`/`sy`/`kx`/`ky`/`algn`/`rotWithShape`。

## 2. 现状

`edd31c4`（阴影写回）把改阴影这件事做通了，但做法是**整个 `a:outerShdw` 节点重写**，因此模型表达不了的属性随之消失。那一刀把这条写进已知限制，并留了一条测试固定它：

```
loses the shadow attributes the model cannot express when it replaces the node
```

**这条限制的理由值得重新审**：那刀自己的核心手法是「只替换最窄的节点」——`a:outerShdw` 而非整个 `a:effectLst`。同一条思路再走一层就是**只改需要改的属性，不换节点**，而这个文件里已经有现成的做法：`lineAttributeReplacements`（`cap`/`cmpd`/`algn` 三个属性共用）正是逐属性打补丁而从不重写开标签。

## 3. 关键决策

**决策 1：属性逐个打补丁，颜色子元素单独替换**

`a:outerShdw` 的建模部分是三个属性（`blurRad`/`dist`/`dir`）加一个颜色子元素。前者复用 `lineAttributeReplacements`（它只依赖元素的 `start` 与 `name`，对任何元素都成立——尖角限制那刀已经这样复用过一次）；后者是子元素，范围与开标签不重叠，因此可以并列生成一个替换。

模型缺某个值时删掉对应属性，与 `cap` 的既有行为一致。

**决策 2：只有「源包没有这个节点」才走整体插入**

节点已存在 → 逐属性 + 颜色替换。节点不存在 → 仍然插入 `serializeShadowXml` 的完整输出（没有什么可保留的）。删除阴影 → 仍然只删那个节点。三条路互斥，与现在相同。

**决策 3：颜色比较仍走 `colorsEqual`，不比字符串**

源包的颜色可能写法不同（`srgbClr` 大小写、transform 顺序）。只有 `colorsEqual` 判不等时才替换颜色子元素，否则那一格不产生替换——这样「只改 `blurRad`」不会顺带重写颜色。

## 4. 契约（增量）

`@ppt4ai/pptx-export`：`shadowReplacements` 在节点已存在时改为逐属性 + 颜色的补丁；`lineAttributeReplacements` 的注释更新（它现在服务 `a:ln` 与 `a:outerShdw` 两种元素，名字保留以免无谓改动调用点）。

## 5. 验证

`packages/pptx-export/src/outer-shadow.test.ts`（改写一条并追加）：
- 改 `blurRadius` → 新值写出，**`sx`/`algn`/`rotWithShape` 逐字保留**（原先固定「会丢」的那条翻过来）
- 改颜色 → 颜色子元素替换，三个属性与未建模属性都不动
- 模型删掉 `distance` → `dist` 属性移除，其余不动
- 只改 `blurRadius` 时颜色子元素逐字不变（决策 3）
- 源包无 `a:effectLst` 时加阴影 → 仍整体插入
- 删阴影 → 仍只删 `a:outerShdw`，`a:glow` 与列表保留

## 6. 已知限制

**新插入的阴影没有未建模属性可谈**：源包本来没有该节点时写出的就是模型的四项，这不是丢失。

## 7. 实现记录（2026-09-05）

实现提交 `3e2d7f4`。按设计执行。

**`lineAttributeReplacements` 第二次被跨元素复用**（尖角限制那刀是第一次）：它只依赖元素的 `start` 与 `name`，因此对 `a:outerShdw` 与 `a:ln` 一样成立。名字里的 `line` 现在是历史残留，但改名要动全部调用点、换不到任何东西，所以只在注释里说明它服务哪些元素。

**颜色节点名要列全**：`srgbClr`/`schemeClr`/`prstClr`/`sysClr`/`scrgbClr`/`hslClr` 六个（`hslClr` 模型读不到，但它出现在源包里时也是那一格的占位者，漏掉会让替换插到它旁边而不是换掉它）。

区分力已验证：把节点补丁改回整体替换，九条里一条标红（`keeps the shadow attributes the model cannot express`）——正是当初固定这条限制的那个位置。
