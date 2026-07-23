import { DISPLAY_TEXT_LIMIT, MISSION_TITLE_LIMIT, safeDisplayText } from "@halext/bridge"

export function shortenPath(path?: string) {
  if (!path) return "No path"
  const segments = path.split(/[\\/]+/).filter(Boolean)
  return safeDisplayText(`/${segments.slice(-4).join("/")}`, MISSION_TITLE_LIMIT)
}

export function explainError(error: unknown) {
  if (!error) return "Unknown server error"
  let text: string | undefined
  if (typeof error === "string") text = error
  if (!text && typeof error === "object" && error) {
    if ("message" in error && typeof error.message === "string") text = error.message
    if (!text && "detail" in error && typeof error.detail === "string") text = error.detail
  }
  if (!text) {
    try {
      text = JSON.stringify(error)
    } catch {
      text = "Unknown server error"
    }
  }
  return safeDisplayText(text || "Unknown server error", DISPLAY_TEXT_LIMIT)
}
