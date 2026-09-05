# 中日韩字体工具栏控件

> 状态：已实现
> 日期：2026-09-05

## 1. 目标

让用户在编辑器里给选中文字设置**中日韩字体**（`a:ea`），而不是只能通过导入文件获得。

`377c631` 那刀已经把 `fontFamilyEa` 打通到模型、排版（按字符分流）、绘制与两条导出路径——**唯独没有控件**，而且 `formatting.ts` 的 `markNames` 白名单不含它，所以 `setTextMarks` 会直接抛错。那刀的设计文档明确写了「工具栏不加控件……是独立切片」，这就是那一刀。

## 2. 现状（读代码所得）

- `TextMarks.fontFamilyEa` 存在，排版层按字符选用，绘制层优先读 `resolvedFontFamily`（`377c631`）
- `packages/text/src/editor/formatting.ts:32` 的 `markNames` 只有七项，**不含 `fontFamilyEa`**；`validatePatch`（同文件 150 行）因此对它抛 `unsupported text mark`
- `TextFormattingState`（同文件 22 行）只暴露 `fontFamily`，状态归约（135 行）也只算西文槽位
- `TextFormattingToolbar.vue` 有一个绑 `state.fontFamily` 的 `<select>`，选项来自 `props.fontFamilies`
- `fontFamilies` 由宿主提供（`PptEditor.vue:42` 的注释说明理由：浏览器无法枚举已安装字体）

## 3. 关键决策

**决策 1：第二个下拉框，与西文槽位并列**

不做「一个下拉框 + 语言切换」的复合控件：`a:latin` 与 `a:ea` 是同一个 run 上**同时生效**的两个槽位，一个混排 run 两者都有值。用两个控件如实反映这一点，用一个会迫使用户理解"当前在编哪个槽位"这种不存在于文档模型里的状态。

**决策 2：`eaFontFamilies` 可选，缺省回退到 `fontFamilies`**

中日韩字体清单与西文清单通常不同，宿主应当能分别给。但若宿主只给了一份，控件仍要可用——因此 `eaFontFamilies ?? fontFamilies`。

不采用「宿主没给就隐藏控件」：那会让这个功能在默认配置下不存在，而默认配置正是 playground 与首批接入方的样子。

**决策 3：白名单加一项，校验与西文同规则**

`markNames` 加 `fontFamilyEa`，`validatePatch` 的非空字符串检查与 `fontFamily` 共用一条分支。

**`fontFamilyCs` 不加**：`377c631` 已记录它「能导入、能写回、能往返，但永远不会被画布选中」——字符→文字系统的判定只区分中日韩/全角与其他。给一个不影响绘制的槽位加控件会让用户以为它生效了。

**决策 4：状态归约同形**

`getTextFormattingState` 增加 `fontFamilyEa`，与 `fontFamily` 逐字相同的 `reduceScalar`：选区内一致则给值，不一致则缺席（下拉框显示"混合"）。

## 4. 契约（增量）

`@ppt4ai/text`：`markNames` 加 `fontFamilyEa`；`TextFormattingState` 加 `readonly fontFamilyEa?: string`；`getTextFormattingState` 归约它；`validatePatch` 的非空检查覆盖它。

`@ppt4ai/editor`：`TextFormattingToolbarProps` 加 `readonly eaFontFamilies?: readonly string[]`；`TextFormattingToolbar.vue` 增加一个 `<select>` 与一个 `fontFamilyEa(event)` 处理函数；`PptEditor.vue` 加同名可选 prop 并透传。

i18n：`toolbar.textFormatting.fontFamilyEa` 中英各一条。

模型、导入、导出、渲染、绘制**都不改**——这一刀只补编辑入口。

## 5. 验证

`packages/text/src/editor/ea-font-mark.test.ts`：
- `setTextMarks({ fontFamilyEa: '宋体' })` 落到选区 run 的 marks 上
- 与 `fontFamily` 同时设置时两个槽位都在
- 空串与非字符串抛错，错误消息与 `fontFamily` 同规则
- 选区内不一致时 `getTextFormattingState().fontFamilyEa` 缺席
- `fontFamilyCs` 仍抛 `unsupported text mark`（本刀边界）

`packages/editor/src/TextFormattingToolbar.test.ts`（追加）：
- 渲染出两个字体下拉框，`aria-label` 各自不同
- 选中 EA 下拉框的一项 emit `{ fontFamilyEa: 值 }`
- `eaFontFamilies` 缺省时选项与 `fontFamilies` 相同
- `state.fontFamilyEa` 缺席时选中"混合"占位项

## 6. 已知限制

**`fontFamilyCs` 仍无控件**：理由见决策 3。

**字体清单仍由宿主提供**：浏览器无法枚举已安装字体，这不是本刀能改的。playground 目前给的是一份西文清单，接入方要中日韩字体需自己给 `eaFontFamilies`。

**主题字体的 `ea` 槽位无关**：主题面板编辑 `+mn-ea` 那类引用是另一条路（`ThemePanel`），本刀只管 run 级直接声明。

## 7. 实现记录（2026-09-05）

实现提交 `待填`。按设计执行，三处值得记：

**回退写在两层，因为 `exactOptionalPropertyTypes`**。设计说「缺省回退到 `fontFamilies`」，实现时 `PptEditor.vue` 把 `props.eaFontFamilies`（`readonly string[] | undefined`）直接透传给可选 prop 被 TS 拒绝——该选项禁止显式传 `undefined` 给可选属性。于是 `PptEditor` 传 `props.eaFontFamilies ?? props.fontFamilies ?? []`，工具栏自己保留 `?? props.fontFamilies` 以便独立使用与单测。两层都有回退，各自单独成立。

**测试必须先建立选区**。第一版三条用例失败：空选区下 `setTextMarks` 只写 `storedMarks`（要等打字才落到 run 上），而 `getTextFormattingState` 读的是光标处的 marks 而非整段。改成每个用例先 `TextSelection.create(doc, 1, size - 1)`——这也正是工具栏的真实用法。

**既有工具栏测试的下标要挪**：中日韩下拉框插在西文与字号之间，`selects[1]` 从字号变成了 EA 字体，两处 `toHaveLength(2)` 变成 3。这类"新增控件让既有下标位移"的改动无法避免，只能靠测试当场标红——它做到了。
