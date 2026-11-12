import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.vue";
import EdgePanel from "./components/Edge/EdgePanel.vue";
import i18n from "./i18n";
import "uno.css";
import "./styles/base.css";
import { initTheme } from "./composables/useTheme";

// 边缘面板是同一份前端产物的第二个窗口（label = "edge"），按窗口分支挂载不同根组件
function resolveRoot() {
  try {
    return getCurrentWindow().label === "edge" ? EdgePanel : App;
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


