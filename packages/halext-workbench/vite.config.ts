import { defineConfig } from "vite"
import workbenchPlugin from "./vite"

export default defineConfig({
  plugins: [workbenchPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3001,
  },
  build: {
    target: "esnext",
  },
})
