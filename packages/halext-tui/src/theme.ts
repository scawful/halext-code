import { RGBA } from "@opentui/core"

type Variant = {
  dark: unknown
  light: unknown
}

export type ThemeData = {
  defs?: Record<string, unknown>
  theme: Record<string, unknown>
}

function ansi(code: number) {
  const base = [
    "#000000",
    "#800000",
    "#008000",
    "#808000",
    "#000080",
    "#800080",
    "#008080",
    "#c0c0c0",
    "#808080",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#0000ff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ]
  if (code < 16) return RGBA.fromHex(base[code] ?? "#000000")
  if (code < 232) {
    const index = code - 16
    const value = (part: number) => (part === 0 ? 0 : part * 40 + 55)
    return RGBA.fromInts(value(Math.floor(index / 36)), value(Math.floor(index / 6) % 6), value(index % 6))
  }
  const gray = (code - 232) * 10 + 8
  return RGBA.fromInts(gray, gray, gray)
}

function variant(value: unknown): value is Variant {
  return typeof value === "object" && value !== null && "dark" in value && "light" in value
}

function resolve(data: ThemeData, value: unknown, mode: "dark" | "light", seen: Set<string>): RGBA {
  if (value instanceof RGBA) return value
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`Invalid ANSI color ${value}`)
    return ansi(value)
  }
  if (variant(value)) return resolve(data, value[mode], mode, seen)
  if (typeof value !== "string") throw new Error("Theme color must be a reference, hex value, ANSI value, or variant")
  if (value === "transparent" || value === "none") return RGBA.fromInts(0, 0, 0, 0)
  if (value.startsWith("#")) {
    if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) throw new Error(`Invalid hex color ${value}`)
    return RGBA.fromHex(value)
  }
  if (seen.has(value)) throw new Error(`Circular theme color reference ${value}`)
  const next = data.defs?.[value] ?? data.theme[value]
  if (next === undefined) throw new Error(`Theme color reference ${value} was not found`)
  const refs = new Set(seen)
  refs.add(value)
  return resolve(data, next, mode, refs)
}

export function color(data: ThemeData, key: string, mode: "dark" | "light" = "dark") {
  const value = data.theme[key]
  if (value === undefined) throw new Error(`Theme color ${key} was not found`)
  return resolve(data, value, mode, new Set([key]))
}
