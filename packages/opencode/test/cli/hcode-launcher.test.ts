import { describe, expect, test } from "bun:test"
import { chmod, mkdir } from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const launcher = path.resolve(import.meta.dir, "../../../..", "scripts/hcode")

describe("hcode launcher AFS environment", () => {
  test("keeps CLI and virtualenv overrides from different checkouts isolated", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const bin = path.join(dir, "bin")
        const project = path.join(dir, "project")
        const workspace = path.join(dir, "workspace")
        await Promise.all([mkdir(bin), mkdir(project), mkdir(workspace)])
        const fakeBun = path.join(bin, "bun")
        await Bun.write(
          fakeBun,
          [
            "#!/usr/bin/env bash",
            "printf 'AFS_CLI=%s\\n' \"${AFS_CLI-<unset>}\"",
            'if [[ "${AFS_VENV+x}" == "x" ]]; then',
            "  printf 'AFS_VENV=%s\\n' \"$AFS_VENV\"",
            "else",
            "  printf 'AFS_VENV=<unset>\\n'",
            "fi",
          ].join("\n"),
        )
        await chmod(fakeBun, 0o755)
        return { bin, project, workspace }
      },
    })

    async function launch(overrides: Record<string, string> = {}) {
      const env = { ...process.env }
      for (const key of ["AFS_BIN", "AFS_CLI", "AFS_ROOT", "AFS_VENV", "SC_SRC_ROOT"]) delete env[key]
      Object.assign(env, {
        PATH: `${tmp.extra.bin}${path.delimiter}${process.env.PATH ?? ""}`,
        HALEXT_HCODE_DIRECTORY: tmp.extra.project,
        SC_WORKSPACE_ROOT: tmp.extra.workspace,
        ...overrides,
      })
      const proc = Bun.spawn(["bash", launcher], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      expect(exitCode, stderr).toBe(0)
      return Object.fromEntries(
        stdout
          .trim()
          .split("\n")
          .map((line) => line.split("=", 2)),
      )
    }

    const defaults = await launch()
    expect(defaults.AFS_CLI).toBe(`${tmp.extra.workspace}/lab/afs/scripts/afs`)
    expect(defaults.AFS_VENV).toBe(`${tmp.extra.workspace}/lab/afs/.venv`)

    const customCli = await launch({ AFS_CLI: "/custom/afs/scripts/afs" })
    expect(customCli.AFS_CLI).toBe("/custom/afs/scripts/afs")
    expect(customCli.AFS_VENV).toBe("<unset>")

    const explicit = await launch({
      AFS_BIN: "/priority/afs",
      AFS_CLI: "/ignored/afs",
      AFS_VENV: "/priority/.venv",
    })
    expect(explicit.AFS_CLI).toBe("/priority/afs")
    expect(explicit.AFS_VENV).toBe("/priority/.venv")
  })
})
