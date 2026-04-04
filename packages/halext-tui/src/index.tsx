import { DEFAULT_BRIDGE_URL } from "@halext/bridge"
import { render } from "@opentui/solid"
import { HalextTuiApp } from "./app"

function parseArgv(argv: string[]) {
  const values: {
    server?: string
    bridge?: string
    directory?: string
    help?: boolean
  } = {}

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === "--help" || item === "-h") {
      values.help = true
      continue
    }
    if (item === "--server") {
      values.server = argv[index + 1]
      index += 1
      continue
    }
    if (item === "--bridge") {
      values.bridge = argv[index + 1]
      index += 1
      continue
    }
    if (item === "--directory") {
      values.directory = argv[index + 1]
      index += 1
    }
  }

  return values
}

const values = parseArgv(Bun.argv.slice(2))

if (values.help) {
  process.stdout.write(
    [
      "halext-tui",
      "",
      "A terminal-first cockpit for opencode + AFS research.",
      "",
      "Options:",
      "  --server <url>      Opencode server URL. Default: http://localhost:4096",
      `  --bridge <url>      Halext bridge URL. Default: ${DEFAULT_BRIDGE_URL}`,
      "  --directory <path>  Optional workspace directory header for SDK calls.",
      "  -h, --help          Show this help text.",
      "",
      "Environment:",
      "  OPENCODE_SERVER_URL",
      "  HALEXT_BRIDGE_URL",
      "  HALEXT_DIRECTORY",
      "",
      "Keys:",
      "  q / Ctrl+C          Quit",
      "  j / Down            Select next session",
      "  k / Up              Select previous session",
      "  i                   Focus the composer",
      "  n                   Create a new session",
      "  r                   Refresh workspace and AFS summary",
      "  p                   Build an AFS session-pack preview",
      "  Enter               Refresh the active session timeline",
      "  Esc                 Leave compose mode",
      "  Enter in composer   Send the prompt",
    ].join("\n") + "\n",
  )
  process.exit(0)
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write("halext-tui requires an interactive terminal. Run with --help for usage.\n")
  process.exit(1)
}

const serverUrl = values.server ?? process.env.OPENCODE_SERVER_URL ?? "http://localhost:4096"
const bridgeUrl = values.bridge ?? process.env.HALEXT_BRIDGE_URL ?? DEFAULT_BRIDGE_URL
const directory = values.directory ?? process.env.HALEXT_DIRECTORY

render(() => <HalextTuiApp serverUrl={serverUrl} bridgeUrl={bridgeUrl} directory={directory} />)
