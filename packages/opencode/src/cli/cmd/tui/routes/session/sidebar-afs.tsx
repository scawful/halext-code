import { existsSync } from "node:fs"
import { join } from "node:path"
import { createMemo, createResource, For, onCleanup, Show } from "solid-js"
import { Process } from "@/util/process"
import { useTheme } from "../../context/theme"
import { useDirectory } from "../../context/directory"

// Fork-owned AFS sidebar section. Reads project-management signals (active
// missions, pending approvals) straight from the AFS CLI so it works without
// the halext bridge running. Renders nothing unless the workspace has a
// .context directory and the CLI returns data — plain upstream behavior
// everywhere else.

type Mission = {
  mission_id: string
  title: string
  status: string
  next_steps: string[]
}

type Approval = {
  agent: string
  action: string
  status: string
}

const REFRESH_MS = 120_000

function cli() {
  return process.env["AFS_BIN"]?.trim() || process.env["AFS_CLI"]?.trim() || "afs"
}

async function loadJson<T>(args: string[]): Promise<T | undefined> {
  const result = await Process.run([cli(), ...args], {
    nothrow: true,
    abort: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  if (!result || result.code !== 0) return undefined
  try {
    return JSON.parse(result.stdout.toString()) as T
  } catch {
    return undefined
  }
}

async function load(directory: string) {
  const [missions, approvals] = await Promise.all([
    loadJson<Mission[]>(["mission", "list", "--path", directory, "--status", "active", "--limit", "3", "--json"]),
    loadJson<Approval[]>(["approvals", "list", "--json"]),
  ])
  return {
    missions: missions ?? [],
    approvals: (approvals ?? []).filter((item) => item.status === "pending"),
  }
}

export function SidebarAfs() {
  const { theme } = useTheme()
  const directory = useDirectory()
  const enabled = createMemo(() => existsSync(join(directory(), ".context")))
  const [state, { refetch }] = createResource(() => (enabled() ? directory() : undefined), load)
  const timer = setInterval(() => {
    if (enabled()) void refetch()
  }, REFRESH_MS)
  onCleanup(() => clearInterval(timer))
  const missions = createMemo(() => state.latest?.missions ?? [])
  const approvals = createMemo(() => state.latest?.approvals ?? [])

  return (
    <Show when={enabled() && (missions().length > 0 || approvals().length > 0)}>
      <box>
        <text fg={theme.text}>
          <b>AFS</b>
        </text>
        <For each={missions()}>
          {(mission) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={mission.status === "blocked" ? theme.warning : theme.success}>
                •
              </text>
              <text fg={theme.text} wrapMode="word">
                {mission.title} <span style={{ fg: theme.textMuted }}>{mission.status}</span>
              </text>
            </box>
          )}
        </For>
        <Show when={approvals().length > 0}>
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={theme.warning}>
              •
            </text>
            <text fg={theme.text} wrapMode="word">
              {approvals().length} approval{approvals().length === 1 ? "" : "s"} pending{" "}
              <span style={{ fg: theme.textMuted }}>resolve via afs approvals</span>
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}
