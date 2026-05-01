import { Keybind } from "@/util/keybind"

export function inspectSequence(all: Record<string, Keybind.Sequence[]>, seq: Keybind.Sequence) {
  let exact = false
  let longer = false
  let open = false
  for (const list of Object.values(all)) {
    for (const item of list) {
      if (Keybind.startsWithSequence(item, seq)) {
        open = true
      }
      if (Keybind.equalSequence(item, seq)) {
        exact = true
      }
      if (item.length > seq.length && Keybind.startsWithSequence(item, seq)) {
        longer = true
      }
    }
  }
  return { open, exact, longer }
}

export function shouldResolveImmediately(state: { exact: boolean; longer: boolean }) {
  return state.exact && !state.longer
}

export function shouldResolveOnTimeout(state: { exact: boolean; longer: boolean }) {
  return state.exact && state.longer
}
