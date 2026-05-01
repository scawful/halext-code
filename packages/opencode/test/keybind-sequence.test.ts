import { describe, expect, test } from "bun:test"
import { Keybind } from "../src/util/keybind"
import {
  inspectSequence,
  shouldResolveImmediately,
  shouldResolveOnTimeout,
} from "../src/cli/cmd/tui/context/keybind-sequence"

function seq(value: string) {
  return Keybind.parseSequence(value)
}

describe("inspectSequence", () => {
  test("handles ambiguous prefix and exact chain states", () => {
    const all = {
      short: seq("<leader> s"),
      long: seq("<leader> s l"),
    }
    expect(inspectSequence(all, seq("<leader> s")[0]!)).toEqual({
      open: true,
      exact: true,
      longer: true,
    })
    expect(inspectSequence(all, seq("<leader> s l")[0]!)).toEqual({
      open: true,
      exact: true,
      longer: false,
    })
  })

  test("supports disambiguation policy for short vs long chains", () => {
    const all = {
      short: seq("<leader> s"),
      long: seq("<leader> s l"),
    }
    const short = inspectSequence(all, seq("<leader> s")[0]!)
    expect(shouldResolveImmediately(short)).toBe(false)
    expect(shouldResolveOnTimeout(short)).toBe(true)

    const long = inspectSequence(all, seq("<leader> s l")[0]!)
    expect(shouldResolveImmediately(long)).toBe(true)
    expect(shouldResolveOnTimeout(long)).toBe(false)
  })

  test("returns closed state for non-matching sequence", () => {
    const all = {
      short: seq("<leader> s"),
      long: seq("<leader> s l"),
    }
    expect(inspectSequence(all, seq("<leader> x")[0]!)).toEqual({
      open: false,
      exact: false,
      longer: false,
    })
  })
})
