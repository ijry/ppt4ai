const zhCN = {
  editor: {
    canvas: {
      ariaLabel: '幻灯片编辑画布',
    },
  },
  toolbar: {
    insert: {
      shape: '插入形状',
    },
    textFormatting: {
      bold: '粗体',
      italic: '斜体',
      underline: '下划线',
      fontFamily: '字体',
      fontSize: '字号',
      color: '文字颜色',
      mixed: '混合',
      align: {
        left: '左对齐',
        center: '居中对齐',
        right: '右对齐',
      },
    },
    tableFormatting: {
      fillColor: '单元格填充颜色',
      clearFill: '清除单元格填充',
      borderColor: '边框颜色',
      borderWidth: '边框宽度',
      borderStyle: '边框样式',
      apply: '应用',
      applyBorders: '应用边框',
      clear: '清除',
      clearBorders: '清除选中边框',
      side: { left: '左边框', right: '右边框', top: '上边框', bottom: '下边框' },
      styles: { solid: '实线', dash: '虚线', dot: '点线' },
    },
  },
  assetLibrary: {
    title: '图片素材',
    empty: '暂无图片素材',
    insert: '插入',
    replace: '替换',
    thumbnailFailure: '缩略图不可用',
    unnamed: '未命名图片（{id}）',
    unknownDimensions: '尺寸未知',
  },
} as const

export default zhCN
