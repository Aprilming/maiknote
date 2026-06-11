import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import i18n from "./i18n";
import "uno.css";
import "./styles/base.css";
import { initTheme } from "./composables/useTheme";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(i18n);

// 初始化主题（在应用挂载前，确保 data-theme 属性及时生效）
initTheme();

app.mount("#app");
