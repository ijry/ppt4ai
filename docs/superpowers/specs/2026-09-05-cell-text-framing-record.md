# 单元格文本边距与锚定切片记录

> 提交：`4c50179` 设计，`be1420a` 实现
> 日期：2026-09-05

## 摘要

第十一刀：**单元格自己的文本边距与垂直锚定**进入模型、解析、绘制与导出。

`a:tcPr/@marL`/`@marR`/`@marT`/`@marB`/`@anchor` 今天整块丢失，所有单元格的文本紧贴左上角绘制。这一刀把它们记为 `TableCell.cellBodyPr`（复用 `TextBodyProperties` 接口但只有边距与锚定生效），场景把它与 `body.bodyPr` 合并后喂给布局 —— 布局已有的 `insets` 与 `verticalAlign` 路径完整，只是没有数据。

## 设计要点

- 模型字段是 `TextBodyProperties`，但导入与导出只认 `insets` 与 `verticalAlign`，其余字段静默过滤
- 场景持有两个字段（`cellBodyPr` 与 `body.bodyPr`）而不合并，因为导出需要知道哪个属性该写回哪个元素
- 边距进口全有或全无（已有规则），出口按字段写；锚定三个词直接映射，缺席时不记录
- **刻意不套用 Office 属性默认值**（marL/marR 91440，marT/marB 45720），理由是会移动画布上每个表格且会覆盖手搭文档的 `marL="0"`；记为待决策项而非已知缺陷

## 新增测试

- `cell-body-properties.test.ts`（三包各一份，导入/场景/导出）
- 导入：四边距与锚定从 `a:tcPr` 进 `cellBodyPr`，与 `a:bodyPr` 分开
- 场景：合并时 `body.bodyPr` 优先；缺 `cellBodyPr` 时行为不变
- 导出：三个锚定词与四边距往返；缺 `cellBodyPr` 时不写 `a:tcPr`

## 四道关

- 215 files / 1789 tests (+13)
- typecheck, build
- boundaries
- 7 e2e

全绿，树干净。

## 已知限制

- 不套用 Office 属性默认值（待决策）
- `a:tcPr` 的其余属性（`@vert`、`@horzOverflow` 等）仍不建模
- 表格样式的 `a:tcStyle/a:tcPr` 仍不建模
- 仍无阅读器实测
