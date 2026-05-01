import { useTerminalDimensions } from "@opentui/solid"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "@tui/context/keybind"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { Keybind } from "@/util/keybind"
import { buildLeaderHints, type Hint } from "./leader-hints-data"
import { createMemo, For, Show } from "solid-js"

export function LeaderHints() {
  const dim = useTerminalDimensions()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const dialog = useDialog()
  const { theme } = useTheme()
  const hints = createMemo(() => buildLeaderHints(command.options(), keybind.seq, keybind.pending))
  const prefix = createMemo(() =>
    keybind.pending
      .map((item) => Keybind.toString({ ...item, leader: false }))
      .filter(Boolean)
      .join(" "),
  )
  const groups = createMemo(() => {
    const map = new Map<string, Hint[]>()
    for (const item of hints()) {
      const list = map.get(item.category) ?? []
      list.push(item)
      map.set(item.category, list)
    }
    return [...map.entries()].map(([category, items]) => ({
      category,
      items,
    }))
  })

  return (
    <Show when={keybind.leader && dialog.stack.length === 0 && hints().length > 0}>
      <box
        position="absolute"
        right={2}
        bottom={2}
        width={Math.min(52, Math.max(32, dim().width - 6))}
        maxHeight={Math.max(8, dim().height - 6)}
        backgroundColor={theme.backgroundPanel}
        border={["left", "right"]}
        borderColor={theme.primary}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.text}>
          <span style={{ fg: theme.primary, bold: true }}>Leader</span>
          <span style={{ fg: theme.textMuted }}>
            {" "}
            {prefix() ? `${prefix()} -> next key` : "next key"}
          </span>
        </text>
        <For each={groups()}>
          {(group) => (
            <box flexDirection="column">
              <text fg={theme.textMuted}>{group.category}</text>
              <For each={group.items}>
                {(item) => (
                  <text fg={theme.text}>
                    <span style={{ fg: theme.primary, bold: true }}>{item.key}</span>
                    <span style={{ fg: theme.textMuted }}> - </span>
                    {item.title}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
