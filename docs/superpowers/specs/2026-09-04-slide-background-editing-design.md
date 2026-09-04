# 幻灯片背景编辑设计

> 状态：设计
> 日期：2026-09-04

## 1. 目标

给幻灯片背景装上入口。`p:bg` 已经能**读取、解析、绘制、写出**（两条导出路径都通），但没有 engine 命令、没有面板 —— 这是本仓库里唯一一项「管线全通、只差入口」的功能，因此也是最省的一刀。

## 2. 现状（读代码确认）

- 模型：`SlideBackground { fill?: Fill; styleRef?: StyleReference }`，`Slide.background`
- 解析：`resolveSlideBackground` 沿 slide → layout → master 取第一个声明者，`SceneGraph.background` 与 `backgroundGradient`
- 绘制：两条路径（画布与缩略图 worker）各自用映射后的页面盒填充
- 导出：standalone 写 `p:bg/p:bgPr`，源包写回保留
- **缺**：`EditorCommand` 里没有任何 `background` 分支（grep 零命中），`packages/editor` 没有背景面板

## 3. 关键决策

**决策 1：命令是 slide 级的，`slideId` 显式传**

```ts
| { type: 'setSlideBackground'; slideId: string; background: SlideBackground | null }
```

`p:bg` 属于某一页，engine 持整份文档，因此像 `setThemeColor` 传 `themeId` 一样显式传 `slideId`，而不是依赖「当前页」这种 engine 里并不存在的概念（playground 的分页是宿主的模型选择）。`null` 删除该页自己的背景，于是解析重新落到 layout/master —— 与 `setElementFill(null)` 让填充回落到样式引用同一条语义。

**决策 2：面板显示「生效的颜色」，但只能改本页自己的**

三态与主题面板同构：本页显式声明（可清除）／继承自 layout 或 master（清除按钮禁用）／整条链都没有背景。显示的颜色取**场景解析后的**那个（`SceneGraph.background`），因为那才是用户看到的；清除按钮的可用性取**本页是否有自己的** `background`。

**决策 3：渐变与 `bgRef` 只显示、不编辑**

一个颜色选择器表达不了 `a:gradFill` 的停靠点，也表达不了 `p:bgRef` 指向的主题条目。面板因此在这两种情形下显示一行说明（「渐变背景」／「主题背景样式」），并明确「挑一个颜色会替换掉它」—— 与工具栏对渐变填充显示 `fillIsGradient` 是同一条：**说实话，而不是把渐变报成它的第一个停靠点**。改渐变本身留给后续切片。

**决策 4：playground 接线，宿主 API 与既有主题面板同款**

`asset-host` 新增 `setSlideBackground(color | null)`，内部解析当前页 id 后转发命令，失败返回既有的稳定状态（`background-failed`）；`App.vue` 侧栏挂面板。i18n 两份 locale 同步加键。

## 4. 契约（增量）

`@ppt4ai/engine`：新增 `setSlideBackground` 命令；slide 缺失、背景非法各有稳定错误；无变化不入 history。

`@ppt4ai/editor`：新增 headless `slideBackgroundModel(background, resolved, resolvedGradient)` 与 `SlideBackgroundPanel.vue`；locale 新增 `panel.slideBackground.*`。

`apps/playground`：`setSlideBackground` 宿主动作 + 面板挂载 + 状态文案。

## 5. 测试策略

- **命令**：设置纯色、清除、undo 恢复、无变化不入 history、slide 不存在报错、非法颜色报错且文档不被部分修改
- **headless 模型**：三态（自有／继承／无）；渐变与 `bgRef` 的两种显示态；颜色取解析值
- **组件**：显示当前色；选色 emit `set-color`；清除 emit `clear`；继承时清除按钮禁用；渐变时显示说明行
- **playground**：宿主动作改文档后场景背景色变化；失败路径返回稳定状态
- **回归**：现有 1577 项

## 6. 已知限制

- 只能设纯色：渐变背景与 `p:bgRef` 只显示不可编辑（决策 3）
- 面板作用于**当前页**，不提供「应用到全部幻灯片」
- layout/master 自己的背景不可编辑（那是 master/layout 编辑的范畴，仍未评估）
- 背景的效果列表（`p:bgPr/a:effectLst`）不建模，写出时仍是空 `a:effectLst`
