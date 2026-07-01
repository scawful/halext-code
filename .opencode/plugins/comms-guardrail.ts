import type { Plugin } from "@opencode-ai/plugin"
import { detectComms, extractDraft, POLICY } from "./comms-guardrail/lib"

/**
 * Comms guardrail — draft-and-confirm for outward communication.
 *
 * Problem: an agent can post to chat/incident channels on the user's behalf by
 * shelling out to a comms CLI (e.g. `gchat post "..."`), and a prior "allow always"
 * grant on `gchat *` would let that ride straight through the permission allowlist
 * without another prompt.
 *
 * This plugin implements the `permission.ask` hook, which hcode now consults for
 * EVERY permission request that config did not already `deny`
 * (see packages/opencode/src/permission/service.ts). Because that hook runs
 * regardless of the evaluated allow / allow-always decision, escalating a matched
 * comms command to `status: "ask"` here is un-bypassable by a stale allow-always.
 * The extracted draft is stashed on the request `metadata` (a free-form field that
 * is published on the `permission.asked` event) so the confirmation dialog can show
 * the user exactly what would be sent.
 *
 * Detection/extraction live in ./comms-guardrail/lib (kept out of the top-level
 * plugins/*.ts glob because the loader invokes every export of a plugin module).
 *
 * Scope: this only ESCALATES (allow -> ask). It never downgrades a decision, and a
 * config `deny` is honored before this hook ever runs.
 */
export const CommsGuardrailPlugin: Plugin = async () => {
  return {
    "permission.ask": async (input, output) => {
      let matchedComms = false
      try {
        // Only gate shell commands; other permission kinds are unaffected.
        if ((input as any).permission !== "bash") return
        const patterns: string[] = Array.isArray((input as any).patterns) ? (input as any).patterns : []
        if (patterns.length === 0) return

        const matched = detectComms(patterns)
        if (!matched) return
        matchedComms = true

        // Escalate: always confirm outward comms, overriding any allow / allow-always.
        output.status = "ask"

        // Surface the draft for the confirmation dialog. On an unparseable payload we
        // still ask and show the raw command (fail-safe).
        const command = patterns.join("\n")
        const draft = extractDraft(command)
        const metadata = ((input as any).metadata ??= {}) as Record<string, unknown>
        metadata.comms_guardrail = {
          channel: matched.channel,
          draft: draft ?? "(could not parse a message payload — review the full command below)",
          command,
          policy: POLICY,
        }
      } catch {
        // Fail closed: only if we had already identified comms intent. We never
        // force a prompt on unrelated commands just because detection threw.
        if (matchedComms) output.status = "ask"
      }
    },
  }
}

export default CommsGuardrailPlugin
