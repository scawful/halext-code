import { createMemo, onCleanup } from "solid-js"
import { Keybind } from "@/util/keybind"
import { pipe, mapValues } from "remeda"
import type { TuiConfig } from "@/config/tui"
import type { ParsedKey, Renderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { useTuiConfig } from "./tui-config"
import { inspectSequence, shouldResolveImmediately, shouldResolveOnTimeout } from "./keybind-sequence"

export type KeybindKey = keyof NonNullable<TuiConfig.Info["keybinds"]> & string

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const config = useTuiConfig()
    const sequences = createMemo<Record<string, Keybind.Sequence[]>>(() => {
      return pipe(
        (config.keybinds ?? {}) as Record<string, string>,
        mapValues((value) => Keybind.parseSequence(value)),
      )
    })
    const keybinds = createMemo<Record<string, Keybind.Info[]>>(() => {
      return pipe(
        sequences(),
        mapValues((value) => value.flatMap((sequence) => (sequence.length === 1 ? [sequence[0]!] : []))),
      )
    })
    const [store, setStore] = createStore({
      leader: false,
      pending: [] as Keybind.Sequence,
    })
    const renderer = useRenderer()
    const listeners = new Set<(seq: Keybind.Sequence) => void>()

    let focus: Renderable | null
    let timeout: NodeJS.Timeout
    function arm() {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        if (!store.leader) return
        const state = inspectSequence(sequences(), store.pending)
        if (store.pending.length > 0 && shouldResolveOnTimeout(state)) {
          const seq = [...store.pending]
          for (const cb of listeners) cb(seq)
        }
        leader(false)
        if (!focus || focus.isDestroyed) return
        focus.focus()
      }, 2000)
    }
    function leader(active: boolean) {
      if (active) {
        setStore("leader", true)
        setStore("pending", [])
        focus = renderer.currentFocusedRenderable
        focus?.blur()
        arm()
        return
      }

      if (!active) {
        if (focus && !renderer.currentFocusedRenderable) {
          focus.focus()
        }
        setStore("pending", [])
        setStore("leader", false)
      }
    }

    const parseEvent = (evt: ParsedKey): Keybind.Info => {
      const isFirst = store.leader && store.pending.length === 0
      if (evt.name === "\x1F") {
        return Keybind.fromParsedKey({ ...evt, name: "_", ctrl: true }, isFirst)
      }
      return Keybind.fromParsedKey(evt, isFirst)
    }

    const sequenceMatch = (key: KeybindKey, seq: Keybind.Sequence) => {
      const list = sequences()[key]
      if (!list) return false
      return list.some((item) => Keybind.equalSequence(item, seq))
    }

    useKeyboard(async (evt) => {
      if (!store.leader && result.match("leader", evt)) {
        leader(true)
        return
      }

      if (store.leader && evt.name) {
        const seq = [...store.pending, parseEvent(evt)]
        const state = inspectSequence(sequences(), seq)
        if (!state.open) {
          setImmediate(() => leader(false))
          return
        }
        setImmediate(() => {
          if (!store.leader) return
          setStore("pending", seq)
        })
        arm()
        if (sequenceMatch("leader", seq)) {
          setImmediate(() => leader(false))
          return
        }
        if (!shouldResolveImmediately(state)) return
        setImmediate(() => leader(false))
      }
    })

    const result = {
      get all() {
        return keybinds()
      },
      get seq() {
        return sequences()
      },
      get leader() {
        return store.leader
      },
      get pending() {
        return store.pending
      },
      parse(evt: ParsedKey): Keybind.Info {
        return parseEvent(evt)
      },
      matchSequence(key: KeybindKey, seq: Keybind.Sequence) {
        const keybind = sequences()[key]
        if (!keybind?.length) return false
        return keybind.some((item) => Keybind.equalSequence(item, seq))
      },
      onResolve(cb: (seq: Keybind.Sequence) => void) {
        listeners.add(cb)
        onCleanup(() => listeners.delete(cb))
      },
      match(key: KeybindKey, evt: ParsedKey) {
        const keybind = sequences()[key]
        if (!keybind?.length) return false
        const seq = [...store.pending, result.parse(evt)]
        if (inspectSequence(sequences(), seq).longer) {
          const exact = keybind.some((item) => Keybind.equalSequence(item, seq))
          if (exact) return false
        }
        return keybind.some((item) => Keybind.equalSequence(item, seq))
      },
      print(key: KeybindKey) {
        const first = sequences()[key]?.at(0)
        if (!first) return ""
        const output = Keybind.sequenceToString(first)
        return output.replace("<leader>", Keybind.toString(keybinds().leader?.[0]))
      },
    }
    return result
  },
})
