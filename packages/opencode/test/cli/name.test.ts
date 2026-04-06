import { afterEach, expect, test } from "bun:test"
import { App } from "../../src/cli/name"

const argv = [...process.argv]
const cli = process.env["OPENCODE_CLI_NAME"]

afterEach(() => {
  process.argv = [...argv]
  if (cli === undefined) delete process.env["OPENCODE_CLI_NAME"]
  else process.env["OPENCODE_CLI_NAME"] = cli
})

test("prefers explicit cli name from env", () => {
  process.argv = ["bun", "/tmp/src/index.ts"]
  process.env["OPENCODE_CLI_NAME"] = "hcode"
  expect(App.name()).toBe("hcode")
  expect(App.title()).toBe("HCode")
  expect(App.initials()).toBe("HC")
  expect(App.mdnsDomain()).toBe("hcode.local")
  expect(App.cmd("models")).toBe("hcode models")
  expect(App.launch("/tmp/repo")).toBe("/tmp/repo/scripts/hcode")
})

test("falls back to argv basename when it looks like a real launcher", () => {
  process.argv = ["bun", "/tmp/bin/hcode"]
  delete process.env["OPENCODE_CLI_NAME"]
  expect(App.name()).toBe("hcode")
})

test("falls back to opencode for bun-driven entrypoints", () => {
  process.argv = ["bun", "/tmp/src/index.ts"]
  delete process.env["OPENCODE_CLI_NAME"]
  expect(App.name()).toBe("opencode")
  expect(App.title()).toBe("OpenCode")
  expect(App.initials()).toBe("OC")
  expect(App.mdnsDomain()).toBe("opencode.local")
  expect(App.launch("/tmp/repo")).toBe("opencode")
})
