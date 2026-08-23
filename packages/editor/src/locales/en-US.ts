const enUS = {
  editor: {
    canvas: {
      ariaLabel: 'Presentation editing canvas',
    },
  },
  toolbar: {
    insert: {
      shape: 'Insert shape',
    },
    textFormatting: {
      bold: 'Bold',
      italic: 'Italic',
      underline: 'Underline',
      fontFamily: 'Font family',
      fontSize: 'Font size',
      color: 'Text color',
      mixed: 'Mixed',
      align: {
        left: 'Align left',
        center: 'Align center',
        right: 'Align right',
      },
    },
    tableFormatting: {
      fillColor: 'Cell fill color',
      clearFill: 'Clear cell fill',
      borderColor: 'Border color',
      borderWidth: 'Border width',
      borderStyle: 'Border style',
      apply: 'Apply',
      applyBorders: 'Apply borders',
      clear: 'Clear',
      clearBorders: 'Clear selected borders',
      side: { left: 'Left border', right: 'Right border', top: 'Top border', bottom: 'Bottom border' },
      styles: { solid: 'Solid', dash: 'Dashed', dot: 'Dotted' },
    },
  },
  assetLibrary: {
    title: 'Image assets',
    empty: 'No image assets',
    insert: 'Insert',
    replace: 'Replace',
    thumbnailFailure: 'Thumbnail unavailable',
    unnamed: 'Unnamed image ({id})',
    unknownDimensions: 'Unknown dimensions',
  },
  playground: {
    assetHost: {
      title: 'Asset operation status',
      selectedAsset: 'Selected asset',
      selectedElement: 'Selected element',
      undoDepth: 'Undo depth',
      statusLabel: 'Latest operation',
      status: {
        idle: 'Waiting for an operation',
        'asset-selected': 'Asset selected',
        'asset-inserted': 'Image inserted',
        'asset-replaced': 'Image replaced',
        'asset-missing': 'Asset is missing',
        'image-target-required': 'Select an image first',
        'asset-operation-failed': 'Image operation failed',
      },
    },
  },
} as const

export default enUS
