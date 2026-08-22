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
} as const

export default enUS
