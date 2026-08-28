# Portable AFS integration

This fork keeps AFS integration in project-owned OpenCode surfaces rather than
changing OpenCode internals:

- `.opencode/opencode.jsonc` starts the slim AFS MCP server with `afs` from
  `PATH`.
- `.opencode/plugins/afs-context.ts` supplies short session guidance and passes
  only the active OpenCode directory as `project_path` to scoped AFS tools.
- `.opencode/commands/afs.md` and its four focused subcommands replace the old
  collection of overlapping command wrappers.
- `.opencode/skills/agentic-context/SKILL.md` gives models one progressively
  loaded AFS procedure without selecting a model or provider.

No central context root, source checkout path, user home, provider endpoint, or
model is committed here. A machine can put any compatible `afs` executable on
`PATH`, or override the MCP entry in its user-level OpenCode configuration.
`AFS_BIN` or `AFS_CLI` may point the grounding plugin at a different executable;
`AFS_MCP_SERVER_NAME` may be set when the MCP server key is renamed.

Use `./scripts/hcode` to prefer an installed `opencode` and fall back to the
current source tree. The launcher preserves the caller's working directory,
points `OPENCODE_CONFIG_DIR` at this checkout's `.opencode` layer, and accepts
`OPENCODE_BIN`, `BUN_BIN`, `HALEXT_CODE_ROOT`, or an explicit
`OPENCODE_CONFIG_DIR` override. Install a checkout-aware symlink without
depending on dotfiles:

```bash
./scripts/install-hcode
# or: ./scripts/install-hcode --bin-dir /company/approved/bin
```

The installer refuses to replace another command unless `--replace` is
explicit and backs the prior target up when replacement is requested.

## Model behavior

The integration deliberately leaves provider and model choice to OpenCode.
Its guidance is concise and schema-oriented so Gemini and other tool-calling
models receive the same small tool surface, explicit scoping, and unambiguous
fallback commands.
