// @refresh reload

import "@/index.css"
import { render } from "solid-js/web"
import { WorkbenchApp } from "./app"

const root = document.getElementById("root")

const DEFAULT_SERVER_URL_KEY = "halext.workbench.defaultServerUrl"

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value === null) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

const getCurrentUrl = () => {
  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (import.meta.env.DEV) {
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  }
  return location.origin
}

if (root instanceof HTMLElement) {
  render(
    () => (
      <WorkbenchApp
        initialServerUrl={getStorage(DEFAULT_SERVER_URL_KEY) ?? getCurrentUrl()}
        onServerUrlChange={(url) => setStorage(DEFAULT_SERVER_URL_KEY, url)}
      />
    ),
    root,
  )
}
