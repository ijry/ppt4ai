import 'uno.css'
import { createApp } from 'vue'
import { createPpt4aiI18n } from '@ppt4ai/editor'
import App from './App.vue'
import AnimationDemo from './AnimationDemo.vue'

// Visit `#animation` to see the animation player driving the SlideCanvas; anything else is the editor.
const root = globalThis.location?.hash === '#animation' ? AnimationDemo : App

createApp(root)
  .use(createPpt4aiI18n('zh-CN'))
  .mount('#app')
