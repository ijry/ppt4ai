# 改填充时保留未建模的部分

> 状态：已实现
> 日期：2026-09-05

## 1. 目标

编辑一个来自源包的填充时，不再整块重写填充节点——因此 `a:gradFill/@flip`、`@rotWithShape`、`a:tileRect` 以及 `a:pattFill` 里的 `a:extLst` 都能活下来。

## 2. 探针结果（实测）

探针已删除。源包写：

```xml
<a:gradFill flip="none" rotWithShape="1">
  <a:gsLst>…两个停靠点…</a:gsLst>
  <a:lin ang="5400000" scaled="0"/>
  <a:tileRect l="10000" t="20000"/>
</a:gradFill>
```

把模型的两个停靠点改成红→绿后导出：

```xml
<a:gradFill><a:gsLst>…新停靠点…</a:gsLst><a:lin ang="5400000"/></a:gradFill>
```

**`flip`、`rotWithShape`、`a:tileRect` 三样全没了**。原因是 `fillReplacements` 用 `serializeFillXml(fill)` 整块替换那个节点。

## 3. 这一刀是上一刀的手法平移

上一刀（`3e2d7f4`）把阴影从「整块重写节点」改成「只补改动的属性」，未建模的 `sx`/`algn`/`rotWithShape` 因此活下来。**填充是同一个形状的同一个问题**，只是节点不同、未建模的东西不同。

发现方式也是那条经验的直接应用：**看上一刀用了什么手法，它常常就是下一刀的答案**。

## 4. 关键决策

**决策 1：同种填充打补丁，换种类才整块替换**

`EG_FillProperties` 是 choice，所以「实心 → 渐变」这种改变确实该整块换节点，没有什么可保留的。而「渐变 → 渐变、只改停靠点」应当只动 `a:gsLst`。

三条同种路径：
- `a:solidFill` → 替换颜色子元素
- `a:gradFill` → 停靠点变了就换 `a:gsLst`；轴/路径形态变了就换 `a:lin`/`a:path`；两者之外的一切（属性、`a:tileRect`）不碰
- `a:pattFill` → `@prst` 走 `lineAttributeReplacements`（它对任何元素都成立，这已是第三次跨元素复用）；前景/背景色各自替换子元素

**决策 2：每一格都先比较再替换**

只改 `a:gsLst` 时不重写 `a:lin`，只改前景色时不动背景色。判据用既有的 `colorsEqual`/`gradientsEqual`/`patternsEqual`，不比字符串——源包写法不同不算变。

**决策 3：`a:lin` 与 `a:path` 之间的切换算形态变化，换那个子元素**

模型的 `gradient.path` 有无决定写哪个。两者是 choice，因此换掉旧的那个、写入新的，而不是同时存在——与虚线 `prstDash`/`custDash` 互斥那刀同一处理。

## 5. 契约（增量）

`@ppt4ai/pptx-export`：`fillReplacements` 在「源节点与模型填充同种」时改为逐部分补丁，否则保持整块替换。`serializeFillXml` 不动（无源导出与换种类仍用它）。

## 6. 验证

`packages/pptx-export/src/fill-node-patch.test.ts`：
- 改渐变停靠点 → 新 `a:gsLst` 写出，**`flip`/`rotWithShape`/`a:tileRect` 逐字保留**
- 只改停靠点时 `a:lin` 逐字不变
- 改渐变角度 → `a:lin` 换掉，`a:gsLst` 不变
- 线性 → 径向 → `a:lin` 换成 `a:path`，且不同时存在
- 改实心填充颜色 → 只换颜色子元素
- 改图案前景色 → `@prst` 与背景色不动，`a:extLst` 保留
- 改图案 `preset` → `@prst` 更新，两个颜色与 `a:extLst` 不动
- 实心 → 渐变（换种类）→ 整块替换（既有行为不回退）
- 未编辑时字节相同

## 7. 已知限制

**换填充种类仍丢未建模内容**：`a:solidFill` → `a:gradFill` 这种改变没有对应关系可保留，整块替换是唯一可做的事。

## 8. 实现记录（2026-09-05）

实现提交 `待填`。按设计执行。

**两条既有测试的预期本来固定着这个损失**：
- `gradient-writeback.test.ts` 的 `rewrites the gradient when a stop colour changes` 断言 `rotWithShape` **不存在**——它记录的正是「改停靠点会丢属性」。改名为 `replaces only the stop list…` 并改成断言属性与 `a:lin` 都在。
- `writeback.test.ts` 的 `writes edited shape and text fills while preserving surrounding XML` 断言 `<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>`,即丢掉 `data-fill="keep"`。**这条测试的名字自己就说了要保留周围的 XML**,所以新行为比旧预期更符合它的意图,只需把预期字符串补上那个属性。

`lineAttributeReplacements` 第三次跨元素复用（`a:ln` → `a:outerShdw` → `a:pattFill/@prst`）。名字里的 `line` 已经明显是历史残留,但三次复用都只用到 `start` 与 `name`,说明抽象本身是对的。

区分力已验证：把同种补丁那一段删掉、退回整块替换,九条里四条标红。
