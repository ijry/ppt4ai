# 编辑器画布 e2e 护栏设计

> 状态：已实现（2026-09-03，`c4477ea`）
> 日期：2026-09-03

## 1. 目标

让上一刀修的坐标空间在真实浏览器里被验证。当前 `SlideCanvas` 被 `PptEditor` 挂载、被 playground 的 `App.vue` 渲染，但没有任何测试断言它画了东西到画布上。前面那刀修的时候发现一处疑似缺陷（变换设成 EMU→设备像素、内容却已经在 CSS 像素），修了它、单测绿了，但**没在真实浏览器里验证** —— 那条记录已写进「已知限制」。

## 2. 当前状态（实测）

**`PptEditor` 确实挂载了 `SlideCanvas`，playground 的 `App.vue` 也挂载了 `PptEditor`**：

```vue
<PptEditor v-if="document" :document="document" :active-slide-id="activeSlideId" @update:active-slide-id="activeSlideId = $event" />
```

而 `SlideCanvas` 里：

```vue
<canvas ref="canvas" :style="{ width, height }" data-slide-canvas />
```

那个 `data-slide-canvas` 就是选择器的锚点，而 playground 里确实会画到这块画布上。

**但此前没有任何 e2e 断言它**。上一刀的单测只断言「内容落在画布内」，是通过 `RecordingContext` 记录 `moveTo`/`lineTo` 的参数，而不是真正的画布像素。

## 3. 关键决策

**决策 1：断言画出内容的**几何分布**，不是像素密度**

修之前的缺陷是「变换把 CSS 像素当 EMU，内容整体缩小约 9525 倍、全挤到画布左上角零点几像素」。能区分对与错的是**内容散布的范围占画布多大比例**，而不是「像素非零的数量」—— 因为即使全挤到一像素，只要那一像素里某个节点的某部分有 alpha > 0，「非零像素数 > 0」这条仍然能过。

**`paintedSpread` 求的是所有非透明像素的包围盒**（`minX`/`minY`/`maxX`/`maxY`），然后断言包围盒的宽高各占画布 50% 以上。修之前这个比值是 0（因为包围盒是空的——连一个非透明像素都没找到，`maxX` 停在 -1），修之后是 0.9+。

**决策 2：`widthRatio` 包一层让 `expect.poll` 有东西可等**

第一版直接 `await paintedSpread` 再 `.width / .canvasWidth`，在本地总是过 —— 但那是因为 `goto` 返回时编辑器早就画完了。`expect.poll` 的作用是**给绘制一个合理的等待窗口**（15 秒），而不是假设 `goto` 一回来画布就有东西。

**决策 3：用预期文件自己的播种页验证，不造新页**

`createPageEntries` 生成的那两页已经有形状、文本、表格，内容足够占满大半画布。发明一个「满页纯色矩形」的页只是在说「能画矩形」，而真正要验证的是**所有节点类型在修正后的坐标空间里都落对了位置** —— 那靠既有页面的混合内容更有说服力。

**决策 4：先 revert 到修之前、确认 spec 会红，再 restore**

不验证「这条 spec 能抓住那个缺陷」，就不知道它是真护栏还是恒过的空断言。实测修之前 `widthRatio` 是 0，断言红在 `Expected: > 0.5 / Received: 0` —— 一个真实的、能挡住坐标回归的护栏。

## 4. 测试策略

- **e2e 层**：`apps/playground/e2e/editor-canvas.spec.ts` 打开 playground、定位到 `canvas[data-slide-canvas]`、等待 `widthRatio > 0.5`、再断言高度占比同样 > 0.5
- **回归验证**：把渲染器 revert 到 `b8db303^`（修之前），spec 必须红；restore 后再跑必须绿
- **全量 e2e**：7 条全过（新增这 1 条 + 此前已有的 6 条）

## 5. 已知限制

- 断言的是「包围盒占画布多大」，而不是「内容在预期位置」—— 所以内容整体偏移、或者某个节点画错了但其余节点仍占满画布，这条 spec 挡不住
- 播种页的内容如果将来改成只占画布一小角（比如只有一个小图标），阈值 0.5 会变得不合理 —— 那时要么降阈值，要么换页
- 坐标空间虽然已验证，但渐变背景还没画，所以渐变的**几何正确性**（轴端点算对了没有）在浏览器里仍未验证 —— 那是下一刀的事
