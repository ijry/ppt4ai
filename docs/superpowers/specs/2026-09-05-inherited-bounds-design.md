# 无 `a:xfrm` 的占位符

> 状态：待实现
> 日期：2026-09-05

## 1. 目标

让**不声明自己位置、靠继承拿 bounds 的占位符**能进模型。这是本会话最严重的一处缺口：元素不是画得不对，而是**根本不存在**。

## 2. 现状（探针，见上一刀记录）

上一刀的探针给 slide 的 title 占位符写 `<p:spPr/>`（无 `a:xfrm`），layout 的同名占位符声明位置。结果：

```
no element imported: []
```

`parseElement`（`importer.ts:1617`）在 `parseBounds` 返回 `undefined` 时返回 `undefined`——文本分支与形状分支都有 `if (!bounds) return undefined`。slide 的元素循环 `if (!element) continue`，于是整个占位符被跳过。

**这是真实且常见的写法**：PowerPoint 生成的页面里，标题与正文占位符经常不重复声明位置，全靠 layout 继承。这类页面在本项目里**丢掉那些占位符**——文字看不见、选不中，只有 layout 的默认值还在。

## 3. 为什么此前判断「会牵动导出索引对齐」，以及为什么那不成立

上一刀记录里写「要修得让 `parseElement` 接受无 bounds 的占位符……会牵动导出的索引对齐」。**读代码后这条不成立**，两个理由：

**索引对齐反而变好**。EMF 的先例说明的是「导入与导出跳过同一个 `p:pic`，索引因此天然对齐」。这里同理：今天导入跳过该占位符，导出也跳过，对齐成立；让它进模型后两侧都不跳过，对齐同样成立。会出问题的是只改一侧。

**写回不会插入 `a:xfrm`**。`boundsReplacements`（`writeback.ts:204`）第一行就是 `const previous = sourceBounds(sourceElement)`，紧接着 `if (!previous || …) return []`——源包没有 `a:xfrm` 时它直接返回空，**从不新建**。`transformReplacements` 同样在 `if (!source) return []` 处退出。所以模型持有继承来的 bounds 而源包没有 `a:xfrm` 这个组合，写回天然保持不动。

这条是本刀能安全落地的全部依据，因此要有一条测试**直接钉住它**：带无 `a:xfrm` 占位符的源包，未编辑时导出字节相同。

## 4. 关键决策

**决策 1：导入时用继承来的 bounds 补齐，模型的 `bounds` 保持必填**

`Element.bounds` 是必填字段，改成可选要动每个消费者（场景、命中、布局、绘制、导出、engine），代价远超收益。因此在导入时补齐：`parseBounds(shape) ?? inheritedBounds`。

**决策 2：继承顺序与 `resolveInheritedElement` 一致**

layout 的默认值优先于 master 的，与 `findDefaults`（`model/index.ts:1306`）逐字相同——那里 master 先入列、layout 后入列，`Object.assign` 因此让 layout 胜出。本刀查 `layout?.defaults?.[key]?.bounds ?? master?.defaults?.[key]?.bounds`。

`key` 用 `parsePlaceholder` 的结果（`type` 或 `type:idx`），与 `elementKey` 同一套写法。

**决策 3：查不到继承 bounds 时仍然跳过**

没有 layout、没有对应默认值、默认值也没声明 bounds——这三种情况下元素确实没有位置可用。**保持今天的行为**（跳过），不发明一个零矩形：那会在页面左上角堆出一批不可见元素，比不导入更糟且更难诊断。

**决策 4：只对占位符生效**

非占位符形状缺 `a:xfrm` 是无从继承的（没有 key 可查），行为不变。

**决策 5：无源导出会写出显式 `a:xfrm`**

模型持有 bounds，`serializeShapeXml` 因此写出位置。源包里那个占位符本来靠继承——这是一处**从隐式变显式**的差异，形状落点相同，不是损坏。写进已知限制。

## 5. 契约（增量）

`@ppt4ai/pptx-import`：`parseElement` 增加可选第四参数 `inheritedBounds?: Rect`，两处 `if (!bounds) return undefined` 之前先回退；slide 的元素循环在调用前按占位符查 layout/master 默认值。

模型、渲染、绘制、导出、写回**都不改**。

## 6. 验证

`packages/pptx-import/src/inherited-bounds.test.ts`：
- slide 占位符无 `a:xfrm`、layout 默认值有 bounds → 元素进模型，bounds 等于 layout 的
- layout 无该默认值而 master 有 → 取 master 的
- 两者都有 → 取 layout 的（与 `resolveInheritedElement` 同向）
- 三处都没有 bounds → 元素仍被跳过（行为不变）
- 非占位符形状无 `a:xfrm` → 仍被跳过
- 占位符自己声明了 `a:xfrm` → 用自己的，不看默认值

`packages/pptx-export/src/inherited-bounds-writeback.test.ts`：
- **带无 `a:xfrm` 占位符的源包，未编辑时导出字节相同**（本刀的安全依据）
- 编辑该元素的 bounds 后仍不新建 `a:xfrm`（写回从不插入）
- 编辑同页另一个元素时，该占位符的 `p:sp` 逐字不变

## 7. 已知限制

**无源导出把继承的位置写成显式的**：见决策 5。

**改 bounds 写不回去**：源包没有 `a:xfrm` 时写回无处落笔，因此对这类占位符的移动/缩放写不出去。这是既有行为（今天这类元素根本不存在，更谈不上移动），本刀让它变成「可见但位置只读」，比不可见严格更好。要真支持得让写回按 ECMA 序列插入 `a:xfrm`，那是独立一刀。
