# 动画 motion path 设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

补上动画的最后一类：motion path（沿路径移动）。此前 `class === 'motion'` 在播放内核里返回 identity。本刀让路径能解析、播放、导入、写回，并在 demo 里演示。

## 2. 关键决策

**决策 1：坐标是幻灯片的分数（经 [MS-OI29500] 核实）**

`p:animMotion@path` 的坐标是**幻灯片尺寸的百分比**（`1,1` = 右下角），大写命令绝对、小写相对（"offset from current position"）——经 MS-OI29500 animMotion 注（走 clash 代理抓取）确认。故给 `ElementOverride` 加 `offsetXSlideRatio`/`offsetYSlideRatio`（幻灯片分数，区别于元素框分数的 `offsetXRatio`）。

**决策 2：解析 + 按弧长插值，曲线取端点**

`parseMotionPath` 解析 M/L/C/Z/E（C 用端点近似，曲线采样留后续），`pointAtProgress` 按段长插值。播放偏移 = `P(eased) - P(0)`。motion 结束后**保持末位**（`itemOverrideAt` 对 motion 在结束后取 `p=1`），不像 entrance/exit 归位——符合真实演示（对象停在路径终点）。

**决策 3：幻灯片分数在 player 层用 page 解析成 EMU**

`overridePaintTransform(bounds, override, page?)`：元素框偏移乘 bounds、幻灯片偏移乘 page，二者汇入同一 translate。`createSlidePlayer` 新增 `page` 选项传给 `paintOverridesFor`。editor 绘制层不变（仍收 EMU translate）。无 page 时幻灯片偏移贡献 0（不崩）。

**决策 4：路径数据走 `params`，写回用 `p:animMotion`**

导入把 `animMotion@path`/`@origin` 存进 `AnimationItem.params`（模型无需加字段）；写回对 motion 发 `<p:animMotion path origin>` 而非 `<p:anim>`。与 [presetClass 词表修正](2026-09-22-animation-presetclass-vocabulary-fix-design.md)（`path`↔`motion`）配合，真实文件的 motion 能往返。

## 3. 测试策略（TDD）

- **animate**（+3 项）：按幻灯片分数偏移（中点/端点）、结束保持末位、相对命令按当前点偏移。
- **player**（+1 项）：幻灯片相对偏移用 page 解析成 EMU translate。
- **pptx-import**（+1 项）：`presetClass="path"` + `animMotion` → class motion + `params.path/origin`。
- **pptx-export**（+1 项）：motion 经 `p:animMotion` export→re-import `toEqual`。
- **demo**：新增第 4 步沿路径移动，player 传 `page`。
- **回归**：全仓 2580 项、全类型检查通过；playground `vite build` 通过。

## 4. 后续

- 曲线（C）采样、motion path preset 形状库（圆/方等，preset id 同源已可查）、`ptsTypes`（smooth/corner）。
