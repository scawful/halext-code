import { Keybind } from "@/util/keybind"

export type Hint = {
  key: string
  title: string
  category: string
}

export type HintOption = {
  title: string
  category?: string
  keybind?: string
  enabled?: boolean
  hidden?: boolean
}

const MAX = 16

export function buildLeaderHints(
  opts: HintOption[],
  binds: Record<string, Keybind.Sequence[]>,
  prefix: Keybind.Sequence,
) {
  const out: Hint[] = []
  const seen = new Set<string>()
  for (const opt of opts) {
    if (opt.enabled === false) continue
    if (opt.hidden) continue
    if (!opt.keybind) continue
    const list = binds[opt.keybind]
    if (!list?.length) continue
    for (const sequence of list) {
      if (prefix.length === 0 && !sequence[0]?.leader) continue
      if (!Keybind.startsWithSequence(sequence, prefix)) continue
      const next = sequence[prefix.length]
      if (!next?.name) continue
      const label = Keybind.toString({ ...next, leader: false })
      if (!label) continue
      if (seen.has(label)) continue
      seen.add(label)
      out.push({
        key: label,
        title: opt.title,
        category: opt.category ?? "General",
      })
    }
  }
  return out
    .toSorted((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category)
      return a.key.localeCompare(b.key)
    })
    .slice(0, MAX)
}
