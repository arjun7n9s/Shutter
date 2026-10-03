import { defineConfig } from "wxt";

/** The only network destination the extension may reach; override at build time for a remote GPU box. */
const SERVER = process.env.PARDA_SERVER ?? "http://127.0.0.1:8000";

export default defineConfig({
  manifest: {
    name: "Shutter",
    description: "Fills the page you are on and redacts personal data on this device. Nothing is uploaded.",
    version: "1.0.0",
    icons: { 16: "icon-16.png", 32: "icon-32.png", 48: "icon-48.png", 128: "icon-128.png" },
    permissions: ["activeTab", "tabs", "scripting", "storage", "sidePanel"],
    host_permissions: ["<all_urls>"],
    action: { default_title: "Open Shutter", default_icon: { 16: "icon-16.png", 32: "icon-32.png", 48: "icon-48.png" } },
    commands: {
      _execute_action: {
        suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" },
        description: "Open Shutter",
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'",
    },
    web_accessible_resources: [],
  },
  vite: () => ({
    define: { __PARDA_SERVER__: JSON.stringify(SERVER) },
  }),
});
