# 百分比图案（`a:pattFill` 第三刀）

> 状态：待实现
> 日期：2026-09-05

## 1. 目标

让 `pct5`…`pct90` 这 12 个百分比图案在画布上按各自的密度呈现，而不是全部画成前景纯色。这是上一刀（`ce8a19c`）写进已知限制的第一条。

今天这 12 个词视觉完全相同——都画成 100% 前景色，也就是**每一个都比它该有的样子更深**，`pct5` 尤其离谱（它该是 5% 覆盖，画出来是满色）。

## 2. 上一刀为什么延期，以及为什么现在能做

上一刀的理由是性能：Office 的百分比图案是 8×8 抖动位图，按点画的话一个满页形状在 100% 缩放下约 1280×720 px，以 8px 间距计是 **14400 个点**，每帧都画。这个数字不能接受，而当时没有别的路子。

现在有：**按名字里的百分比调前景色的 alpha**。

## 3. 关键决策

**决策 1：百分比族画成半透明前景压在背景上，不画点**

`pct50` 的含义是「50% 的像素是前景色」。把前景色以 50% alpha 铺满，得到的**平均颜色与它一致**，而且：

- 零额外操作（一次 `fillRect`，与背景同量级）
- 与缩放无关，不存在数量爆炸
- 单调：`pct5` 浅、`pct90` 深，12 个词终于互不相同且排序正确

代价是**不画出点阵结构**：真实阅读器在高缩放下能看到离散的点，本项目画的是平滑混色。这是「平均颜色对、微观结构不对」的近似，比今天「平均颜色也不对」严格更好。

**这不是发明数值**：`pct50` → 0.5 直接来自词本身，与线条族从 `Horz` 取方向同一性质。

**决策 2：用正则解析而不是枚举 12 个词**

```ts
const match = /^pct(\d+)$/.exec(preset)
```

理由：我无法在此核实 `ST_PresetPatternVal` 的百分比子集究竟是哪 12 个（常见说法是 5/10/20/25/30/40/50/60/70/75/80/90，但这是记忆不是核实）。正则对任何 `pctNN` 都成立，因此**不会因为我记错列表而漏掉某个词**，也不会把不存在的词写进常量。

`PAINTED_PRESET_PATTERNS` 仍需要具体词（它是给消费者查的），列常见的 12 个；但绘制路径不依赖这份列表，遇到 `pct15` 也照样画。这个不对称是刻意的：常量宁可少列，绘制宁可多认。

**决策 3：新增独立函数，不改 `patternGeometry` 的返回类型**

百分比图案不是线条，硬塞进 `PatternGeometry` 要把返回值改成可辨识联合，13 个既有测试全部要加 `kind` 判断。

改为并列一个函数：

```ts
export function patternCoverage(preset: string): number | undefined
```

返回 0..1 的覆盖率，非百分比词返回 `undefined`。两个函数各司其职，既有测试一行不动。

**决策 4：绘制层先试线条、再试覆盖率、都不中才回退**

`paintPatternFill` 的顺序：`patternGeometry` → `patternCoverage` → 返回 `false`（调用方画前景纯色）。三条路互斥。

## 4. 契约（增量）

`@ppt4ai/geometry`：新增 `patternCoverage(preset)`。

`@ppt4ai/model`：`PAINTED_PRESET_PATTERNS` 从 18 个词增加到 30 个（补 12 个 `pctNN`）。

`@ppt4ai/editor`：`paintPatternFill` 新增覆盖率分支——铺背景色，再以 `coverage × 前景alpha` 铺前景色。仍在 `clip(path)` 内，仍只投一次阴影。

## 5. 验证

`packages/geometry/src/pattern-coverage.test.ts`：

- `pct50` → 0.5，`pct5` → 0.05，`pct90` → 0.9
- 三位数与非标准值也解析（`pct100` → 1，`pct15` → 0.15）——正则的意义
- 非百分比词返回 `undefined`（`ltHorz`、`zigZag`、`pct`、`pctfoo`、`pct50x`）
- 超过 100 的值返回 `undefined`（`pct150` 不是合法覆盖率）
- `PAINTED_PRESET_PATTERNS` 里每个 `pct` 词都能拿到覆盖率，每个非 `pct` 词都能拿到线条几何（两条路合起来盖住整份常量）

`packages/editor/src/pattern-painting.test.ts`（追加）：

- `pct50` 记录 `clip` → `fillRect`（背景）→ `fillRect`（前景），**不** `stroke`
- 前景那次 `fillRect` 时 `globalAlpha` 等于 0.5
- `pct90` 的前景 alpha 大于 `pct5` 的（单调，也就是这刀要修的那件事）
- 前景色为半透明时两者相乘（`alpha 50000` 的前景配 `pct50` → 0.25）

## 6. 已知限制

**不画点阵结构**：高缩放下与真实阅读器可见差异，平均颜色一致。列入阅读器核对清单 2.4（与线条族的磁量并列）。

**装饰族仍画前景纯色**：`zigZag`/`weave`/`sphere`/`shingle`/`plaid`/`divot`/`trellis`/`horzBrick` 等词的形状不在名字里，猜不出来，继续回退。这是 `a:pattFill` 最后一块未画的部分。
