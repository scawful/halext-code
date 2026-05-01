import { isDeepEqual } from "remeda"
import type { ParsedKey } from "@opentui/core"

export namespace Keybind {
  /**
   * Keybind info derived from OpenTUI's ParsedKey with our custom `leader` field.
   * This ensures type compatibility and catches missing fields at compile time.
   */
  export type Info = Pick<ParsedKey, "name" | "ctrl" | "meta" | "shift" | "super"> & {
    leader: boolean // our custom field
  }
  export type Sequence = Info[]

  export function match(a: Info | undefined, b: Info): boolean {
    if (!a) return false
    const normalizedA = { ...a, super: a.super ?? false }
    const normalizedB = { ...b, super: b.super ?? false }
    return isDeepEqual(normalizedA, normalizedB)
  }

  /**
   * Convert OpenTUI's ParsedKey to our Keybind.Info format.
   * This helper ensures all required fields are present and avoids manual object creation.
   */
  export function fromParsedKey(key: ParsedKey, leader = false): Info {
    return {
      name: key.name === " " ? "space" : key.name,
      ctrl: key.ctrl,
      meta: key.meta,
      shift: key.shift,
      super: key.super ?? false,
      leader,
    }
  }

  export function toString(info: Info | undefined): string {
    if (!info) return ""
    const parts: string[] = []

    if (info.ctrl) parts.push("ctrl")
    if (info.meta) parts.push("alt")
    if (info.super) parts.push("super")
    if (info.shift) parts.push("shift")
    if (info.name) {
      if (info.name === "delete") parts.push("del")
      else parts.push(info.name)
    }

    let result = parts.join("+")

    if (info.leader) {
      result = result ? `<leader> ${result}` : `<leader>`
    }

    return result
  }

  export function sequenceToString(sequence: Sequence | undefined): string {
    if (!sequence?.length) return ""
    return sequence.map((step) => toString(step)).filter(Boolean).join(" ")
  }

  export function equalSequence(a: Sequence, b: Sequence): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!match(a[i], b[i]!)) return false
    }
    return true
  }

  export function startsWithSequence(sequence: Sequence, prefix: Sequence): boolean {
    if (prefix.length > sequence.length) return false
    for (let i = 0; i < prefix.length; i++) {
      if (!match(sequence[i], prefix[i]!)) return false
    }
    return true
  }

  function parseStep(token: string): Info {
    const parts = token.toLowerCase().split("+")
    const info: Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "",
    }

    for (const part of parts) {
      switch (part) {
        case "ctrl":
          info.ctrl = true
          break
        case "alt":
        case "meta":
        case "option":
          info.meta = true
          break
        case "super":
          info.super = true
          break
        case "shift":
          info.shift = true
          break
        case "leader":
          info.leader = true
          break
        case "esc":
          info.name = "escape"
          break
        default:
          info.name = part
          break
      }
    }

    return info
  }

  export function parseSequence(key: string): Sequence[] {
    if (key === "none") return []
    return key
      .split(",")
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((combo) => combo.replace(/<leader>\s+/gi, "<leader>").replace(/<leader>/gi, "leader+"))
      .map((combo) => combo.split(/\s+/).map((step) => parseStep(step)))
      .map((sequence) => {
        const out: Sequence = []
        for (const step of sequence) {
          if (step.leader && !step.name && out.length < sequence.length - 1) continue
          out.push(step)
        }
        return out
      })
      .filter((sequence) => sequence.length > 0)
  }

  export function parse(key: string): Info[] {
    return parseSequence(key).map((sequence) => sequence[0]!).filter(Boolean)
  }
}
