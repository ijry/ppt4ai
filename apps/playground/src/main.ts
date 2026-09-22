import 'uno.css'
import { createApp } from 'vue'
import { createPpt4aiI18n } from '@ppt4ai/editor'
import App from './App.vue'
import AnimationDemo from './AnimationDemo.vue'
import EditorApp from './EditorApp.vue'

// `#dev` → the old test harness, `#animation` → the animation player demo, everything else → the editor.
const hash = globalThis.location?.hash
const root = hash === '#dev' ? App : hash === '#animation' ? AnimationDemo : EditorApp

createApp(root)
  .use(createPpt4aiI18n('zh-CN'))
  .mount('#app')
