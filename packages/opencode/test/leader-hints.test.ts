import { describe, expect, test } from "bun:test"
import { buildLeaderHints, type HintOption } from "../src/cli/cmd/tui/component/leader-hints-data"
import type { Keybind } from "../src/util/keybind"

describe("buildLeaderHints", () => {
  test("returns leader start keys sorted by category and key", () => {
    const opts: HintOption[] = [
      { title: "Switch model", keybind: "model_list", category: "Agent" },
      { title: "New session", keybind: "session_new", category: "Session" },
      { title: "Status", keybind: "status_view", category: "System" },
    ]
    const binds: Record<string, Keybind.Sequence[]> = {
      model_list: [[{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "m" }]],
      session_new: [[{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "n" }]],
      status_view: [[{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "s" }]],
    }
    expect(buildLeaderHints(opts, binds, [])).toEqual([
      { category: "Agent", key: "m", title: "Switch model" },
      { category: "Session", key: "n", title: "New session" },
      { category: "System", key: "s", title: "Status" },
    ])
  })

  test("ignores non-leader, hidden, and disabled commands", () => {
    const opts: HintOption[] = [
      { title: "Hidden", keybind: "hidden", category: "System", hidden: true },
      { title: "Disabled", keybind: "disabled", category: "System", enabled: false },
      { title: "Plain", keybind: "plain", category: "System" },
      { title: "Leader", keybind: "leader", category: "System" },
    ]
    const binds: Record<string, Keybind.Sequence[]> = {
      hidden: [[{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "h" }]],
      disabled: [[{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "d" }]],
      plain: [[{ leader: false, ctrl: false, meta: false, shift: false, super: false, name: "p" }]],
      leader: [[{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "l" }]],
    }
    expect(buildLeaderHints(opts, binds, [])).toEqual([{ category: "System", key: "l", title: "Leader" }])
  })

  test("deduplicates conflicting leader keys by first command", () => {
    const opts: HintOption[] = [
      { title: "First", keybind: "first", category: "System" },
      { title: "Second", keybind: "second", category: "System" },
    ]
    const binds: Record<string, Keybind.Sequence[]> = {
      first: [[{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "x" }]],
      second: [[{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "x" }]],
    }
    expect(buildLeaderHints(opts, binds, [])).toEqual([{ category: "System", key: "x", title: "First" }])
  })

  test("filters to next keys for pending leader chain", () => {
    const opts: HintOption[] = [
      { title: "Save file", keybind: "file_save", category: "Files" },
      { title: "Open file", keybind: "file_open", category: "Files" },
      { title: "New session", keybind: "session_new", category: "Session" },
    ]
    const binds: Record<string, Keybind.Sequence[]> = {
      file_save: [
        [
          { leader: true, ctrl: false, meta: false, shift: false, super: false, name: "f" },
          { leader: false, ctrl: false, meta: false, shift: false, super: false, name: "s" },
        ],
      ],
      file_open: [
        [
          { leader: true, ctrl: false, meta: false, shift: false, super: false, name: "f" },
          { leader: false, ctrl: false, meta: false, shift: false, super: false, name: "o" },
        ],
      ],
      session_new: [[{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "n" }]],
    }
    expect(
      buildLeaderHints(opts, binds, [{ leader: true, ctrl: false, meta: false, shift: false, super: false, name: "f" }]),
    ).toEqual([
      { category: "Files", key: "o", title: "Open file" },
      { category: "Files", key: "s", title: "Save file" },
    ])
  })
})
