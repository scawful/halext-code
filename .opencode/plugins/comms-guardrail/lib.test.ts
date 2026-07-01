import { describe, expect, test } from "bun:test"
import { commandName, detectCommand, detectComms, extractDraft } from "./lib"
import CommsGuardrailPlugin from "../comms-guardrail"

async function runHook(permission: string, patterns: string[]) {
  const hooks = await CommsGuardrailPlugin({} as any)
  const input: any = { permission, patterns, metadata: {} }
  const output = { status: "allow" as "allow" | "ask" | "deny" }
  await hooks["permission.ask"]!(input, output)
  return { input, output }
}

describe("commandName", () => {
  test("plain binary", () => expect(commandName('gchat post "x"')).toBe("gchat"))
  test("absolute path -> basename", () => expect(commandName("/usr/local/bin/gchat post")).toBe("gchat"))
  test("relative path -> basename", () => expect(commandName("./gchat send")).toBe("gchat"))
  test("skips leading env assignment", () => expect(commandName("GCHAT_TOKEN=abc gchat post")).toBe("gchat"))
  test("skips sudo wrapper", () => expect(commandName("sudo sendmail -t")).toBe("sendmail"))
})

describe("detectCommand", () => {
  test("flags gchat", () => expect(detectCommand('gchat post "hello team"')).toBe("Google Chat"))
  test("flags chat send subcommand", () => expect(detectCommand("chat send --space X")).toBe("Chat send"))
  test("flags Google Chat webhook via curl", () =>
    expect(detectCommand("curl -X POST https://chat.googleapis.com/v1/spaces/AAA/messages -d @b.json")).toBe(
      "Webhook (curl)",
    ))
  test("flags a generic /webhooks/ curl", () =>
    expect(detectCommand("curl https://example.com/api/webhooks/123 -d hi")).toBe("Webhook (curl)"))
  test("does NOT flag an ordinary curl", () =>
    expect(detectCommand("curl https://example.com/api/data.json")).toBeNull())
  test("flags afs approvals approve (self-approval attempt)", () =>
    expect(detectCommand("afs work approvals approve 42 --by human")).toBe("AFS approval execute"))
  test("flags afs approvals execute", () =>
    expect(detectCommand("afs work approvals execute 42")).toBe("AFS approval execute"))
  test("does NOT flag other afs commands", () => expect(detectCommand("afs work approvals list")).toBeNull())
})

describe("detectComms (per-request, over parsed command list)", () => {
  test("flags gchat after a pipe (separate command entry)", () => {
    expect(detectComms(['echo "msg"', "gchat send"])?.channel).toBe("Google Chat")
  })
  test("ignores ordinary commands", () => {
    expect(detectComms(["ls -la"])).toBeNull()
    expect(detectComms(["git status"])).toBeNull()
    expect(detectComms(["cat README.md"])).toBeNull()
  })
  test("does not false-positive on a commit message mentioning chat send", () => {
    expect(detectComms(['git commit -m "add chat send feature"'])).toBeNull()
  })
  test("does not false-positive on gchat inside a quoted string only", () => {
    expect(detectComms(['echo "gchat is a tool"'])).toBeNull()
  })
})

describe("permission.ask hook contract", () => {
  test("escalates allow -> ask for a comms command and attaches the draft", async () => {
    const { input, output } = await runHook("bash", ['gchat post "deploy starting"'])
    expect(output.status).toBe("ask")
    expect(input.metadata.comms_guardrail.channel).toBe("Google Chat")
    expect(input.metadata.comms_guardrail.draft).toBe("deploy starting")
  })
  test("still asks (fail-safe) but flags unparsed draft when payload is opaque", async () => {
    const { input, output } = await runHook("bash", ["gchat post-file /tmp/body.bin"])
    expect(output.status).toBe("ask")
    expect(input.metadata.comms_guardrail.draft).toContain("could not parse")
  })
  test("leaves ordinary commands untouched", async () => {
    const { input, output } = await runHook("bash", ["ls -la"])
    expect(output.status).toBe("allow")
    expect(input.metadata.comms_guardrail).toBeUndefined()
  })
  test("ignores non-bash permission kinds", async () => {
    const { output } = await runHook("edit", ["whatever"])
    expect(output.status).toBe("allow")
  })
})

describe("extractDraft", () => {
  test("pulls a double-quoted payload", () => {
    expect(extractDraft('gchat post "hello team"')).toBe("hello team")
  })
  test("pulls a --message= flag payload", () => {
    expect(extractDraft('gchat post --message="deploying now"')).toBe("deploying now")
  })
  test("pulls a -m single-quoted payload", () => {
    expect(extractDraft("gchat post -m 'quick note'")).toBe("quick note")
  })
  test("pulls a heredoc body", () => {
    expect(extractDraft("gchat post <<EOF\nmulti\nline\nEOF")).toBe("multi\nline")
  })
  test("returns the longest quoted string when several are present", () => {
    expect(extractDraft('gchat post --space "spaces/AAA" "the actual longer message body"')).toBe(
      "the actual longer message body",
    )
  })
  test("returns null when there is no payload", () => {
    expect(extractDraft("gchat list")).toBeNull()
  })
})
