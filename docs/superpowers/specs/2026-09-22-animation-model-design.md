# 动画模型层设计

> 状态：已实现（模型层，2026-09-22）
> 日期：2026-09-22

## 1. 目标

路线图 §10 动画的第一刀:建模型。按架构 §5.1"存预设+参数、不存关键帧"的决策,给文档模型加动画时间线类型与校验,为后续导入/导出/播放引擎打底。不碰渲染/播放(那是后续切片)。

## 2. 关键决策

**决策 1：模型存命名预设 + pptx 原生编号,不存关键帧**

pptx 动画本质是 `p:cTn` 上的 `presetClass`/`presetID`/`presetSubtype`。`AnimationItem` 存 `class`(entrance/exit/emphasis/motion)、稳定 `preset` 名(如 `fade`)、以及 `presetId`/`presetSubtype`(回写用的原生编号)、`duration`/`delay`/`repeat`/`buildType`/`params`。存关键帧曲线就永远回写不回去(§5.1)。

**决策 2：时间线挂在文档级 `animations`,按 slideId 键**

`Ppt4aiDocument.animations?: Record<slideId, SlideTimeline>`;`SlideTimeline` 有 `mainSeq`(主点击序列)与可选 `interactiveSeq`(点击对象/媒体触发)。文档级而非塞进 `Slide`,与 timelines 按页组织的 pptx 结构一致,也不动既有 `Slide` 形状。

**决策 3：校验进 `validateDocument`**

`validateTimeline`/`validateAnimationBuild`/`validateAnimationItem`:trigger/class 限枚举、`targetId` 必须引用存在的元素、数值项非负、`params` 值必须是字符串、时间线的 slideId 必须存在。与其它模型校验同风格,`create*`/`dispatch` 会自动兜底。

## 3. 测试策略（TDD）

- **模型**（`animation.test.ts`,6 项）:合法主序列通过;targetId 缺失、未知 trigger/class、时间线挂在缺失页、非字符串 params/负时长均拒;无动画文档通过。
- **回归**:全量 2510 项。

## 4. 后续（本刀不含）

- 导入:`p:timing` → `animations`(预设映射表,§5.1 说的 ~110 个预设)。
- 导出:`animations` → `p:timing`(往返)。
- 播放引擎:rAF + 缓动,产出 SceneGraph 之上的 transform/opacity override(§5.2),不污染文档。
- engine 编辑命令与编辑器 UI。
