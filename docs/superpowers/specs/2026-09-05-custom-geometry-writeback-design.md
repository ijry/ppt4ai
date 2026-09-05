# 自定义几何的源包写回

> 状态：待实现
> 日期：2026-09-05

## 1. 目标

让**修改一个来自源包的形状的自定义路径**能写回文件。这是上一刀（`edd31c4`）的审计指出的第二个真缺口。

## 2. 探针结果（实测）

探针已删除。源包写一个完整的 `a:custGeom`（含 `a:avLst`、`a:gdLst`、`a:rect`、`a:pathLst`）：

| 步骤 | 结果 |
|---|---|
| 导入 | `customGeometry = {paths:[{width:100,height:100,commands:[…]}]}`——**读得出** |
| 把 `customGeometry` 换成 200×200 的新路径后导出 | 原 `w="100" h="100"` 路径不动，**编辑静默丢失** |
| 把 `preset` 改成 `hexagon` 后导出 | 整个 `a:custGeom` 被 `<a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom>` 取代 |

## 3. 上一刀写的搁置理由是错的

上一刀写：「替换一条路径与替换一个属性不是同一量级……`a:custGeom` 里有 `a:avLst`/`a:gdLst`/`a:rect`/`a:pathLst`，而模型只表达字面坐标的 `a:pathLst`，所以『按模型重写』会丢掉前三者」。

**「按模型重写」是我自己设的前提，而上一刀本身就否证了它**：阴影那刀的做法正是**只替换最窄的节点**（`a:outerShdw`，而非整个 `a:effectLst`），未建模的兄弟因此在构造上不受影响。同一招用在这里就是**只替换 `a:pathLst`**，`a:avLst`/`a:gdLst`/`a:rect` 一个字节都不碰。

探针的输出直接印证：那三个兄弟在编辑后原样都在。

**真正的成本是另一件事**：比较需要一个源侧的路径读取器，那是把 `parseCustomGeometry` 的四十来行镜像到写回层。这条成本是真的，处置见决策 3。

## 4. 关键决策

**决策 1：只替换 `a:pathLst`，并把比较放进 `geometryReplacements`**

几何节点已经有一个所有者（`geometryReplacements` 负责 `prst` 词与 `a:avLst`）。路径比较放进同一个函数，理由与尖角限制折进 `lineJoinReplacements` 逐字相同：**两个补丁处理同一段范围会冲突**——探针第二条显示，改 `preset` 会整块替换 `a:custGeom`，此时不能再有一个补丁去改它内部的 `a:pathLst`。

**决策 2：只处理「源有 `a:custGeom`、模型有 `customGeometry`」这一格**

- 源有 `a:custGeom`、模型没有 → 不动。删掉 `a:pathLst` 会留下非法的空 `a:custGeom`，而把它换成 `a:prstGeom` 是「改几何类型」那件事，不是本刀。
- 源有 `a:prstGeom`、模型有 `customGeometry` → 不动。同上，属于类型转换。

两格都写进未实现，因为它们需要的是「几何类型转换」的决策而非路径比较。

**决策 3：镜像读取器必须有一条测试钉住它与导入端一致**

`sourceFill`/`sourceTextBody`/`sourceOuterShadow` 都是这种镜像，仓库已接受这个分工（两层读的是不同的 XML 表示）。但镜像会漂移，而漂移的后果是「无谓重写」或「编辑被吞」——两者都难发现。

因此本刀额外加一条测试：**同一段 XML 喂给导入端与源侧读取器，两者必须产出相同的模型**。既有的四个镜像都没有这样的测试，这条是本刀顺带补上的更强保障。

## 5. 契约（增量）

`@ppt4ai/pptx-export`：`geometry-source.ts` 新增 `sourceCustomGeometry(geometryNode)`；`geometryReplacements` 增加 `a:pathLst` 比较与替换。

模型、导入、渲染、绘制**不改**。

## 6. 验证

`packages/pptx-export/src/custom-geometry-writeback.test.ts`：
- 未编辑时字节相同
- 改路径 → 新 `a:pathLst` 写出，**`a:avLst`/`a:gdLst`/`a:rect` 逐字不变**（决策 1 的要点）
- 只改 bounds 时 `a:custGeom` 逐字不变
- 改 `preset` 时仍整块替换（既有行为不回退）
- 模型没有 `customGeometry` 时不动源包（决策 2）
- **源侧读取器与导入端对同一段 XML 产出相同模型**（决策 3）

## 7. 已知限制

**几何类型转换写不回去**：源 `a:custGeom` ↔ 模型 `preset`、源 `a:prstGeom` ↔ 模型 `customGeometry` 两个方向都不动。见决策 2。

**带公式的路径本来就不进模型**：`parseCustomGeometry` 只吃字面坐标，因此这类 `a:custGeom` 的 `customGeometry` 是 `undefined`，落在决策 2 的第一格，源包原样保留。
