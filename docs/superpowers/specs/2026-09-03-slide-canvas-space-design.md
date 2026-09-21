# 幻灯片画布坐标空间修正设计

> 状态：已实现（2026-09-03，`b8db303`）
> 日期：2026-09-03

## 1. 目标

修正 `slide-canvas-renderer.ts` 的坐标空间。上一刀记为「疑似缺陷」，本刀把它查实到根因并修掉 —— 这是渐变背景的前置条件，也是那条被推迟的原因。

## 2. 探针结果（实测）

`zoom=1`、`dpr=1`、页面 12192000×6858000 EMU，一个满页形状加一个背景：

```
canvas   : 1280 x 720 device px
transform: ["setTransform",0.00010498687664041995,0,0,0.00010498687664041995,0,0]
fillRect : ["fillRect",0,0,1280,720]
lineTo   : ["lineTo",1280,720]
```

画布是 1280×720 设备像素，内容也落在 1280×720 —— 但变换的缩放是 `0.000105`，于是那 1280 只映射到约 **0.13 个设备像素**。三者自相矛盾。

## 3. 根因（三处对照读出来的，不是推断）

仓里有三条绘制路径，对照即可定案：

| 路径 | 变换 | 内容坐标 | 一致？ |
|---|---|---|---|
| `thumbnail-worker.ts` | **无变换** | 目标像素（`mapping.scale` 映射，图片走 `mapBounds`） | ✅ |
| `image-canvas-renderer.ts` | EMU→设备像素 | **EMU**（`paintImageNode(…, node.bounds)`） | ✅ |
| `slide-canvas-renderer.ts` | EMU→设备像素 | **CSS 像素**（形状/文本/表格）+ **EMU**（图片） | ❌ |

所以 slide 渲染器**同时错了两处，且方向相反**：

1. 它抄了 image 渲染器的 EMU→设备像素变换，却把形状、文本、表格按 `scale = EMU_TO_CSS_PIXEL·zoom` 映射成 CSS 像素再画进去 —— 这两者叠乘，内容缩小 9525·zoom 倍。
2. 图片却是 `paintImageNode(context, node, outcome.image, node.bounds)`，传的是**原始 EMU** —— 与 thumbnail worker 的 `mapBounds(node.bounds, mapping)` 不同。所以在当前变换下**图片恰好是对的，其余全都不对**。

`thumbnail-worker.ts` 是做对了的那条，也是仓里唯一自洽且被产品实际使用的绘制路径。

**关于「它有 e2e 所以更可信」这句话要修正**：`apps/playground/e2e/thumbnail.spec.ts` 确实存在，但**实测当前是红的** —— 而且把本切片的改动全部 stash 之后**同样是红的**，所以它是既有失败、与本刀无关，也因此**不能拿它当本刀的验证依据**。判定 thumbnail worker 做得对，依据是下面那条可判定事实，不是那条 e2e。

**绘制层为「像素」而写，这一点是可判定的**：`paintShapeNode` 的 `Math.max(1, strokeWidth * mapping.scale)`、`dashPattern(style, width)`、表格边框的同款下限，都只有在 `mapping` 产出像素时才有意义。若改成「让绘制层收 `scale=1`、内容走 EMU」，那个一像素下限就变成一 EMU 下限，等于没有下限。**因此该改的是变换，不是绘制层。**

## 4. 为什么没被发现

- `apps/` 下**没有任何东西**通过 `createSlideCanvasRenderer` 渲染 —— 只有 `packages/editor/src/SlideCanvas.vue` 用它，而没有 app 挂载 `SlideCanvas`。真正在跑的缩略图走 thumbnail worker，是对的那条。
- 单测只断言 `setTransform` 的**参数值**（`toBeCloseTo(0.000314…)`），从不断言内容落在画布内。**断言参数等于把实现抄进测试**，实现错了测试跟着错。

## 5. 关键决策

**决策 1：改变换与图片映射，向 thumbnail worker 收敛，不动绘制层**

```ts
context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
…
paintImageNode(context, node, outcome.image, mapBounds(node.bounds, scale))
```

内容是 CSS 像素，`dpr` 把它送到设备像素。两处改动都是让 slide 渲染器与 thumbnail worker 说同一种坐标 —— 后者是自洽且被产品实际使用的那条。

**否决「让绘制层收 `scale=1`、内容走 EMU」**（即向 image 渲染器收敛）：那要把一像素下限、虚线长度、字号全部重新定义，而且会让 slide 与 thumbnail 两条路径的 `mapping` 语义分叉 —— 它们共用同一批绘制函数。

**决策 2：测试断言内容落在画布内，不再断言变换参数**

新断言的形式是「满页内容的极值等于画布的设备像素尺寸」。这条**在修之前必须是红的** —— 它正是原本缺的那条。既有那条断言 `0.000314…` 的测试改为断言 `dpr`，因为它现在测的是「CSS→设备像素」这件有意义的事。

**决策 3：`dpr=1` 时变换退化为恒等，但仍显式设置**

不写成「`dpr===1` 就跳过」：`setTransform` 前一行的 `clearRect` 需要恒等变换，两次调用的配对关系是这段代码的既有结构，保留它比省一次调用重要。

## 6. 契约（增量）

无对外契约变化。`createSlideCanvasRenderer` 的返回值、`cssWidth`/`cssHeight`、`drawnNodeIds` 全不变 —— 变的只是画到画布上的位置。

## 7. 测试策略

- **落点**：满页形状的 `lineTo` 极值等于 `cssWidth`/`cssHeight`；背景 `fillRect` 覆盖整个 CSS 尺寸；两者在 `dpr=2`、`zoom=1.5` 下随变换正确放大（断言变换为 `dpr`）
- **图片**：图片节点的绘制矩形是映射后的 CSS 像素，与形状同一空间（修前它是 EMU，与形状差 9525 倍）
- **一致性**：同一场景在 slide 渲染器与 thumbnail worker 下，满页形状占满各自画布
- **回归**：现有 1237 项测试，尤其 `slide-canvas-renderer.test.ts` 那条断言变换参数的

## 8. 已知限制

- **未在真实浏览器里验证**。修正依据是三条路径的对照与「绘制层为像素而写」这一可判定事实，不是像素比对截图。要真正闭环需要给 `SlideCanvas` 加一条 playwright 用例，而 `apps/` 目前没有挂载它 —— 那是独立切片。
- `image-canvas-renderer.ts` 仍是 EMU 空间。它自身一致，本刀不动它；但仓里因此仍有两种 `mapping` 语义。
- `SlideCanvas.vue` 无 app 挂载，因此本刀的修正在产品里暂时看不到效果。
- **两条既有失败/配置问题（实测，与本刀无关）**：①`apps/playground/e2e/thumbnail.spec.ts` 当前是红的，把本刀改动全部 stash 后同样是红的；②`playwright.config.ts` 的 `testDir: './apps'` 配合 playwright 默认 `testMatch` 会把 vitest 的 `*.test.ts` 一起收进 e2e 运行，因此 `npx playwright test` 会在 vitest 文件上报错。两条都不在本刀范围。
