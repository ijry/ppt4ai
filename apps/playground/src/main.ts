import 'uno.css'
import { createApp } from 'vue'
import { createPpt4aiI18n } from '@ppt4ai/editor'
import App from './App.vue'

createApp(App)
  .use(createPpt4aiI18n('zh-CN'))
  .mount('#app')
