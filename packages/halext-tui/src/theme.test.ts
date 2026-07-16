import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import hcodeGhostty from "../../../.opencode/themes/hcode-ghostty.json"
import { color, type ThemeData } from "./theme"

function ints(value: ReturnType<typeof color>) {
  return value.toInts()
}

describe("theme colors", () => {
  test("resolves the shared hcode palette", () => {
    expect(ints(color(hcodeGhostty, "background"))).toEqual([11, 15, 20, 255])
    expect(ints(color(hcodeGhostty, "primary"))).toEqual([116, 176, 255, 255])
    expect(ints(color(hcodeGhostty, "error"))).toEqual([240, 125, 156, 255])
  })

  test("supports recursive references, variants, transparent values, and ANSI colors", () => {
    const theme: ThemeData = {
      defs: { first: "second", second: "#123456" },
      theme: {
        recursive: "first",
        linked: "recursive",
        variant: { dark: "linked", light: "#ffffff" },
        clear: "none",
        ansi: 12,
      },
    }
    expect(ints(color(theme, "variant"))).toEqual([18, 52, 86, 255])
    expect(ints(color(theme, "variant", "light"))).toEqual([255, 255, 255, 255])
    expect(ints(color(theme, "clear"))).toEqual([0, 0, 0, 0])
    expect(ints(color(theme, "ansi"))).toEqual([0, 0, 255, 255])
  })

  test("rejects missing and circular references", () => {
    expect(() => color({ theme: { bad: "missing" } }, "bad")).toThrow("was not found")
    expect(() => color({ defs: { one: "two", two: "one" }, theme: { bad: "one" } }, "bad")).toThrow("Circular")
  })

  test("allows a definition to share the requested theme key", () => {
    expect(ints(color({ defs: { background: "#123456" }, theme: { background: "background" } }, "background"))).toEqual([
      18, 52, 86, 255,
    ])
  })

  test("keeps the Ghostty profile aligned with shared key colors", async () => {
    const profile = await readFile(resolve(import.meta.dir, "../../../ghostty/hcode-ghostty.conf"), "utf8")
    expect(profile).toContain(`background = ${hcodeGhostty.defs.bg0}`)
    expect(profile).toContain(`foreground = ${hcodeGhostty.defs.fg0}`)
    expect(profile).toContain(`cursor-color = ${hcodeGhostty.defs.blue}`)
  })
})
