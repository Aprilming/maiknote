import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.vue";
import EdgePanel from "./components/Edge/EdgePanel.vue";
import DesktopNote from "./components/Desktop/DesktopNote.vue";
import i18n from "./i18n";
import "uno.css";
import "./styles/base.css";
import { initTheme } from "./composables/useTheme";

// 同一份前端产物被多个窗口复用，按窗口 label 挂不同的根组件：
//   main            → 主界面
//   edge            → 贴边面板
//   note-widget-<id>→ 钉在桌面上的笔记卡片
function resolveRoot() {
  try {
    const label = getCurrentWindow().label;
    if (label.startsWith("note-widget-")) return DesktopNote;
    return label === "edge" ? EdgePanel : App;
  } catch {
    return App;
  }
}

const Root = resolveRoot();

const app = createApp(Root);
const pinia = createPinia();

app.use(pinia);
app.use(i18n);

// 初始化主题（在应用挂载前，确保 data-theme 属性及时生效）
initTheme().then(() => {
  app.mount("#app");
});


