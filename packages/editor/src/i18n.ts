import { createI18n } from 'vue-i18n'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'

export const locales = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const

export type EditorLocale = keyof typeof locales

export const createPpt4aiI18n = (locale: EditorLocale = 'zh-CN') =>
  createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en-US',
    messages: locales,
  })
