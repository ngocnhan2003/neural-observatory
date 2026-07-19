# Neural Observatory

A local-first Electron dashboard that turns AI agent telemetry into a living 3D neural field. It supports:

- Claude Code lifecycle/tool hooks
- Codex OpenTelemetry JSON logs and `agent-turn-complete` notify fallback
- Generic OpenAI-compatible event ingestion
- WebSocket live updates
- Local SQLite history with in-memory fallback
- Replay-friendly unified event schema
- A GPU-rendered decorative neural brain and measured observability dashboard

Gemini CLI integration is intentionally not included.

## License

MIT © ngocnhan2003. See [LICENSE](LICENSE).

## Run

```powershell
npm install
npm run dev
```

The local event bridge listens on `127.0.0.1:4319`. If that port is occupied, the app selects a free port and generates provider integration files for that port.

### Troubleshooting startup

**`Error: Electron uninstall` when running `npm run dev`** — the Electron binary was not downloaded during `npm install` (its postinstall script was skipped or its download failed, e.g. behind a proxy or a sandboxed install). Download it manually:

```powershell
node node_modules/electron/install.js
```

**`'electron-vite' is not recognized`** — the launcher shims in `node_modules/.bin` are missing. Re-run `npm install`, then check for the Electron binary again (`node_modules/electron/dist/electron.exe`); reinstalling can remove it, in which case run the install script above once more.

## Connect Claude Code

Open **Integrations** in the app and click **Install** next to Claude Code. The installer:

1. Writes a tiny local hook relay under the app user-data directory.
2. Backs up `~/.claude/settings.json`.
3. Adds non-blocking command hooks for session, prompt, tool, compaction and stop events.

Restart Claude Code and run `/hooks` to inspect the installed hooks.

Claude Code hooks do not expose a guaranteed per-token stream. Prompt token values shown from hook-only sessions are marked **estimated**; tool/session events are measured.

## Connect Codex

Open **Integrations** and click **Install** next to Codex/OpenAI. The installer backs up `~/.codex/config.toml`, configures:

```toml
notify = ["node", "<generated local notify script>"]

[otel]
environment = "neural-observatory"
log_user_prompt = false
exporter = { otlp-http = { endpoint = "http://127.0.0.1:4319/v1/logs", protocol = "json" } }
```

If your config already has an `[otel]` table, Neural Observatory does not overwrite it. The UI shows a snippet to merge manually.

## Generic event endpoint

Send normalized events to:

```text
POST http://127.0.0.1:4319/events
Content-Type: application/json
```

Example:

```json
{
  "provider": "openai",
  "sessionId": "my-session",
  "type": "usage.updated",
  "data": {
    "inputTokens": 1200,
    "outputTokens": 310,
    "totalTokens": 1510,
    "contextPercent": 18
  }
}
```

Allowed event types are defined in `src/shared/events.ts`.

## Privacy model

- The server binds to localhost only.
- Claude prompt bodies are not persisted; only an estimated length-derived token count may be recorded.
- Codex is configured with `log_user_prompt = false`.
- The normalizer drops keys that look like prompts, text content, tool inputs, tool outputs or messages.
- Neural animation is explicitly labeled decorative.

## Build Windows installer

```powershell
npm run package:win
```

Output is written to `release/`.

## Architecture

```text
Claude hooks ───────┐
Codex OTLP/notify ──┼─> Local event bridge ─> unified AIEvent ─> SQLite
Generic /events ────┘              │
                                   └─> WebSocket ─> Zustand ─> R3F brain + dashboard
```

## Send a manual Windows test sequence

With the app open:

```powershell
.\scripts\send-test-events.ps1
```

This sends a short OpenAI-style test session to the generic event endpoint without calling any model or spending tokens.
