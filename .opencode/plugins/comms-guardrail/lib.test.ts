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
  test("skips sudo flags before shell", () => expect(commandName("sudo -E bash -lc 'gchat post \"x\"'")).toBe("bash"))
  test("skips quoted env assignments before shell", () =>
    expect(commandName("env GCHAT_TOKEN='abc def' bash -lc 'gchat post \"x\"'")).toBe("bash"))
  test("resolves env split-string commands", () => {
    expect(commandName('env -S "gchat post hi"')).toBe("gchat")
    expect(commandName('env --split-string="gchat post hi"')).toBe("gchat")
    expect(commandName('env -S "-C /tmp gchat post" hi')).toBe("gchat")
    expect(commandName('env -ivS "gchat post hi"')).toBe("gchat")
  })
  test("skips execution-wrapper flags and their operands", () => {
    expect(commandName("sudo --user root gchat post")).toBe("gchat")
    expect(commandName("sudo -D /tmp gchat post")).toBe("gchat")
    expect(commandName("sudo -R /chroot gchat post")).toBe("gchat")
    expect(commandName("sudo -nD /tmp gchat post")).toBe("gchat")
    expect(commandName("sudo -Eu root gchat post")).toBe("gchat")
    expect(commandName("sudo --chroot=/chroot gchat post")).toBe("gchat")
    expect(commandName("sudo --background --set-home gchat post")).toBe("gchat")
    expect(commandName("env --unset TOKEN gchat post")).toBe("gchat")
    expect(commandName("env --ignore-environment gchat post")).toBe("gchat")
    expect(commandName("env -C /tmp gchat post")).toBe("gchat")
    expect(commandName("command -p -- gchat post")).toBe("gchat")
    expect(commandName("timeout --signal TERM 5 gchat post")).toBe("gchat")
    expect(commandName("nice --adjustment 5 gchat post")).toBe("gchat")
    expect(commandName("time -f '%E real' -- gchat post")).toBe("gchat")
    expect(commandName("nohup -- gchat post")).toBe("gchat")
    expect(commandName("xargs -0 -n 1 gchat post")).toBe("gchat")
    expect(commandName("xargs -I {} gchat post {} ")).toBe("gchat")
    expect(commandName("xargs --eof --max-lines gchat post")).toBe("gchat")
    expect(commandName("exec -a chat-client gchat post")).toBe("gchat")
  })
  test("does not treat command inspection as execution", () => {
    expect(commandName("command -v gchat")).toBe("")
    expect(commandName("command -V sendmail")).toBe("")
  })
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
  test("does NOT treat webhook text in curl option values as a target", () => {
    expect(detectCommand("curl -H 'X-Note: https://hooks.slack.com/not-a-target' https://example.com/data")).toBeNull()
    expect(detectCommand("curl -o https://hooks.slack.com/not-a-target https://example.com/data")).toBeNull()
    expect(detectCommand("curl --referer https://hooks.slack.com/not-a-target https://example.com/data")).toBeNull()
    expect(detectCommand("curl --proxy https://hooks.slack.com/not-a-target https://example.com/data")).toBeNull()
    expect(detectCommand("curl -w https://hooks.slack.com/not-a-target https://example.com/data")).toBeNull()
    expect(detectCommand("curl --connect-to https://hooks.slack.com:not-a-target https://example.com/data")).toBeNull()
    expect(detectCommand("curl --data-urlencode 'note=https://hooks.slack.com/no' https://example.com/data")).toBeNull()
    expect(detectCommand("curl --cookie https://hooks.slack.com/not-a-target https://example.com/data")).toBeNull()
    expect(detectCommand("curl --resolve https://hooks.slack.com:not-a-target https://example.com/data")).toBeNull()
    expect(detectCommand("curl --cert https://hooks.slack.com/not-a-target https://example.com/data")).toBeNull()
  })
  test("still recognizes targets after curl flag clusters", () =>
    expect(detectCommand("curl -fsSL https://hooks.slack.com/services/X")).toBe("Webhook (curl)"))
  test("recognizes targets after implicit curl boolean negations", () => {
    expect(detectCommand("curl --no-location https://hooks.slack.com/services/X")).toBe("Webhook (curl)")
    expect(detectCommand("curl --no-silent https://hooks.slack.com/services/X")).toBe("Webhook (curl)")
    expect(detectCommand("curl --no-insecure https://hooks.slack.com/services/X")).toBe("Webhook (curl)")
    expect(detectCommand("curl --no-compressed https://hooks.slack.com/services/X")).toBe("Webhook (curl)")
    expect(detectCommand("curl --no-parallel https://hooks.slack.com/services/X")).toBe("Webhook (curl)")
  })
  test("flags afs approvals approve (self-approval attempt)", () =>
    expect(detectCommand("afs work approvals approve 42 --by human")).toBe("AFS approval execute"))
  test("flags afs approvals execute", () =>
    expect(detectCommand("afs work approvals execute 42")).toBe("AFS approval execute"))
  test("does NOT flag other afs commands", () => expect(detectCommand("afs work approvals list")).toBeNull())

  // Shell-wrapper bypass: a comms command hidden inside `bash -lc '...'` etc. must
  // still be detected — argv[0] is the shell, not the comms binary.
  test("flags gchat inside bash -lc", () => expect(detectCommand("bash -lc 'gchat post \"hi\"'")).toBe("Google Chat"))
  test("flags gchat inside sh -c (double-quoted script)", () =>
    expect(detectCommand('sh -c "gchat send"')).toBe("Google Chat"))
  test("flags gchat as a non-leading command in a shell script", () =>
    expect(detectCommand("zsh -c 'ls -la; gchat post \"y\"'")).toBe("Google Chat"))
  test("flags sendmail behind env + bash wrapper", () =>
    expect(detectCommand("env bash -lc 'sendmail -t < body.txt'")).toBe("Email"))
  test("flags gchat behind sudo flags + bash wrapper", () =>
    expect(detectCommand("sudo -E bash -lc 'gchat post \"hi\"'")).toBe("Google Chat"))
  test("flags gchat behind quoted env assignment + bash wrapper", () =>
    expect(detectCommand("env GCHAT_TOKEN='abc def' bash -lc 'gchat post \"hi\"'")).toBe("Google Chat"))
  test("flags a webhook curl inside a shell wrapper", () =>
    expect(detectCommand("bash -c 'curl https://hooks.slack.com/services/X -d @-'")).toBe("Webhook (curl)"))
  test("flags an afs self-approval inside a shell wrapper", () =>
    expect(detectCommand("sh -c 'afs work approvals approve 42 --by human'")).toBe("AFS approval execute"))
  test("flags comms behind execution wrappers with flags", () => {
    expect(detectCommand("sudo --user root gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo -D /tmp gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo -R /chroot gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo -nD /tmp gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo -nR /chroot gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo -Eu root gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo --chroot=/chroot gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo --background gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo --askpass gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo --bell gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo --set-home gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo --preserve-groups gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo --reset-timestamp gchat post hi")).toBe("Google Chat")
    expect(detectCommand("sudo --shell gchat post hi")).toBe("Google Chat")
    expect(detectCommand("env --unset TOKEN gchat post hi")).toBe("Google Chat")
    expect(detectCommand("env -C /tmp gchat post hi")).toBe("Google Chat")
    expect(detectCommand("env --ignore-environment gchat post hi")).toBe("Google Chat")
    expect(detectCommand('env -S "gchat post hi"')).toBe("Google Chat")
    expect(detectCommand('env --split-string="gchat post hi"')).toBe("Google Chat")
    expect(detectCommand('env -S "-C /tmp gchat post" hi')).toBe("Google Chat")
    expect(detectCommand('env -vS "gchat post hi"')).toBe("Google Chat")
    expect(detectCommand('env -ivS "gchat post hi"')).toBe("Google Chat")
    expect(detectCommand("env -S \"-vS 'gchat post hi'\"")).toBe("Google Chat")
    expect(detectCommand("command -p -- gchat post hi")).toBe("Google Chat")
    expect(detectCommand("timeout 5 gchat post hi")).toBe("Google Chat")
    expect(detectCommand("nice gchat post hi")).toBe("Google Chat")
    expect(detectCommand("time -f '%E real' gchat post hi")).toBe("Google Chat")
    expect(detectCommand("nohup -- sendmail -t")).toBe("Email")
    expect(detectCommand("xargs -0 -n 1 gchat post")).toBe("Google Chat")
    expect(detectCommand("xargs --max-args=1 sh -c 'gchat post hi'")).toBe("Google Chat")
    expect(detectCommand("exec -a chat-client gchat post hi")).toBe("Google Chat")
  })
  test("flags an inline shell exec with flags", () =>
    expect(detectCommand("bash -lc 'exec -a chat-client gchat post \"hi\"'")).toBe("Google Chat"))
  test("flags an inline shell exec after an option terminator", () =>
    expect(detectCommand("bash -c -- 'exec -- gchat post \"hi\"'")).toBe("Google Chat"))
  test("does not let wrapper option text create a webhook false positive", () =>
    expect(detectCommand("time -f 'https://hooks.slack.com/not-a-command' curl https://example.com/data")).toBeNull())
  test("does not split shell separators inside a quoted message", () =>
    expect(detectCommand("bash -lc 'gchat post \"deploy A; then B && C\"'")).toBe("Google Chat"))
  // Fail-safe direction only: a benign shell wrapper must NOT be flagged.
  test("does NOT flag a benign shell wrapper", () =>
    expect(detectCommand("bash -lc 'ls -la && git status'")).toBeNull())
  test("does NOT flag a shell running a script file (no -c inline)", () =>
    expect(detectCommand("bash deploy.sh gchat")).toBeNull())
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
  test("catches a comms command wrapped in bash -lc (the reported bypass)", () => {
    expect(detectComms(["bash -lc 'gchat post \"hi\"'"])?.channel).toBe("Google Chat")
  })
  test("catches a comms command wrapped in sudo/env shell layers", () => {
    expect(detectComms(["sudo -E bash -lc 'gchat post \"hi\"'"])?.channel).toBe("Google Chat")
    expect(detectComms(["env GCHAT_TOKEN='abc def' bash -lc 'gchat post \"hi\"'"])?.channel).toBe("Google Chat")
  })
  test("returns the exact matched command rather than a benign sibling", () => {
    expect(detectComms(['echo "a much longer benign sibling"', 'gchat post "hi"'])).toEqual({
      channel: "Google Chat",
      command: 'gchat post "hi"',
      payload: 'gchat post "hi"',
    })
    expect(detectComms(['bash -lc \'echo "a much longer benign sibling"; exec gchat post "hi"\''])).toEqual({
      channel: "Google Chat",
      command: 'bash -lc \'echo "a much longer benign sibling"; exec gchat post "hi"\'',
      payload: 'gchat post "hi"',
    })
    expect(detectComms(['env -S "gchat post hi"'])).toEqual({
      channel: "Google Chat",
      command: 'env -S "gchat post hi"',
      payload: "gchat post hi",
    })
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
  test("escalates a bash -lc wrapped comms command and still parses the draft", async () => {
    const { input, output } = await runHook("bash", ["bash -lc 'gchat post \"deploy starting\"'"])
    expect(output.status).toBe("ask")
    expect(input.metadata.comms_guardrail.channel).toBe("Google Chat")
    expect(input.metadata.comms_guardrail.draft).toBe("deploy starting")
  })
  test("escalates sudo/env wrapped comms commands and still parses the draft", async () => {
    const sudo = await runHook("bash", ["sudo -E bash -lc 'gchat post \"deploy starting\"'"])
    expect(sudo.output.status).toBe("ask")
    expect(sudo.input.metadata.comms_guardrail.draft).toBe("deploy starting")

    const env = await runHook("bash", ["env GCHAT_TOKEN='abc def' bash -lc 'gchat post \"deploy starting\"'"])
    expect(env.output.status).toBe("ask")
    expect(env.input.metadata.comms_guardrail.draft).toBe("deploy starting")
  })
  test("extracts the draft only from the matched sibling", async () => {
    const { input, output } = await runHook("bash", [
      'echo "this benign sibling is deliberately much longer"',
      'time -f "another long benign wrapper value" gchat post "hi"',
    ])
    expect(output.status).toBe("ask")
    expect(input.metadata.comms_guardrail.command).toBe('time -f "another long benign wrapper value" gchat post "hi"')
    expect(input.metadata.comms_guardrail.draft).toBe("hi")
  })
  test("extracts the draft from an inline exec rather than its benign shell sibling", async () => {
    const { input } = await runHook("bash", [
      'bash -lc \'echo "this benign sibling is deliberately much longer"; exec -a chat gchat post "hi"\'',
    ])
    expect(input.metadata.comms_guardrail.command).toBe(
      'bash -lc \'echo "this benign sibling is deliberately much longer"; exec -a chat gchat post "hi"\'',
    )
    expect(input.metadata.comms_guardrail.draft).toBe("hi")
  })
  test("shows assignments and identity wrappers in the exact command", async () => {
    const env = await runHook("bash", ['GCHAT_SPACE=private gchat post "hi"'])
    expect(env.input.metadata.comms_guardrail.command).toBe('GCHAT_SPACE=private gchat post "hi"')
    expect(env.input.metadata.comms_guardrail.draft).toBe("hi")

    const sudo = await runHook("bash", ['sudo --user deploy gchat post "hi"'])
    expect(sudo.input.metadata.comms_guardrail.command).toBe('sudo --user deploy gchat post "hi"')
    expect(sudo.input.metadata.comms_guardrail.draft).toBe("hi")

    const split = await runHook("bash", ['env -S "gchat post hi"'])
    expect(split.input.metadata.comms_guardrail.command).toBe('env -S "gchat post hi"')
    expect(split.input.metadata.comms_guardrail.draft).toBe("hi")
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
  test("uses the chat message positional rather than a longer target", () => {
    expect(extractDraft('gchat post --space "spaces/AAA" "the actual longer message body"')).toBe(
      "the actual longer message body",
    )
    expect(extractDraft('gchat post --space "spaces/a-very-long-target-name" "hi"')).toBe("hi")
  })
  test("uses curl data rather than a longer header", () => {
    expect(
      extractDraft(
        'curl -H "Authorization: Bearer deliberately-very-long-secret" https://hooks.slack.com/services/X -d "hi"',
      ),
    ).toBe("hi")
  })
  test("does not claim a partial or indirect curl body is the exact draft", () => {
    expect(extractDraft('curl https://hooks.slack.com/services/X -d "a=1" -d "b=2"')).toBeNull()
    expect(extractDraft("curl https://hooks.slack.com/services/X --data-binary @body.json")).toBeNull()
    expect(extractDraft("curl https://hooks.slack.com/services/X --data-binary @-")).toBeNull()
    expect(extractDraft("curl https://hooks.slack.com/services/X --data-urlencode name@body.txt")).toBeNull()
  })
  test("does not guess an opaque quoted argument is a draft", () => {
    expect(extractDraft('sendmail -s "a very long destination or subject" user@example.com')).toBeNull()
  })
  test("returns null when there is no payload", () => {
    expect(extractDraft("gchat list")).toBeNull()
  })
})
