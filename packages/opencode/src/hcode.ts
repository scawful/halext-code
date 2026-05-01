const target = process.env.HALEXT_HCODE_DIRECTORY

process.env.OPENCODE_CLI_NAME ||= "hcode"

if (target) {
  try {
    process.chdir(target)
    process.env.PWD = process.cwd()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Failed to change directory to ${target}: ${detail}\n`)
    process.exit(1)
  }
}

await import("./index")
