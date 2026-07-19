import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { InstallResult, IntegrationStatus } from '../../shared/events'

const CLAUDE_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'SessionEnd'
]

function ensureParent(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}

function backup(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined
  const backupPath = `${filePath}.neural-observatory.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  copyFileSync(filePath, backupPath)
  return backupPath
}

function commandFor(scriptPath: string): string {
  return `node ${JSON.stringify(scriptPath)}`
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

export function ensureHookScripts(hookDirectory: string, port: number): {
  claudeScriptPath: string
  codexScriptPath: string
} {
  mkdirSync(hookDirectory, { recursive: true })
  const claudeScriptPath = join(hookDirectory, 'claude-hook.cjs')
  const codexScriptPath = join(hookDirectory, 'codex-notify.cjs')

  const postHelper = `
const http = require('node:http')
function post(pathname, payload) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload))
    const request = http.request({
      hostname: '127.0.0.1', port: ${port}, path: pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length },
      timeout: 700
    }, (response) => { response.resume(); response.on('end', resolve) })
    request.on('timeout', () => { request.destroy(); resolve() })
    request.on('error', resolve)
    request.end(body)
  })
}
`

  writeFileSync(
    claudeScriptPath,
    `'use strict'\n${postHelper}\nlet input = ''\nprocess.stdin.setEncoding('utf8')\nprocess.stdin.on('data', (chunk) => { input += chunk })\nprocess.stdin.on('end', async () => {\n  try { await post('/hooks/claude', JSON.parse(input || '{}')) } catch {}\n  process.stdout.write(JSON.stringify({ suppressOutput: true }))\n})\n`,
    'utf8'
  )

  writeFileSync(
    codexScriptPath,
    `'use strict'\n${postHelper}\n;(async () => {\n  try { await post('/hooks/codex', JSON.parse(process.argv[2] || '{}')) } catch {}\n})()\n`,
    'utf8'
  )

  return { claudeScriptPath, codexScriptPath }
}

export function getIntegrationStatus(hookDirectory: string, port: number): IntegrationStatus {
  const { claudeScriptPath, codexScriptPath } = ensureHookScripts(hookDirectory, port)
  const claudePath = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')
  const codexPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
  const claudeCommand = commandFor(claudeScriptPath)
  const codexNotifyLine = `notify = [${tomlString('node')}, ${tomlString(codexScriptPath)}]`

  let claudeConfigured = false
  if (existsSync(claudePath)) {
    try {
      const parsed = JSON.parse(readFileSync(claudePath, 'utf8')) as Record<string, unknown>
      const hooks = (parsed.hooks && typeof parsed.hooks === 'object' ? parsed.hooks : {}) as Record<string, unknown>
      claudeConfigured = Object.values(hooks).some((groups) =>
        Array.isArray(groups) && groups.some((group) => {
          const handlers = group && typeof group === 'object' && Array.isArray((group as Record<string, unknown>).hooks)
            ? ((group as Record<string, unknown>).hooks as Array<Record<string, unknown>>)
            : []
          return handlers.some((handler) => handler.command === claudeCommand)
        })
      )
    } catch {
      claudeConfigured = false
    }
  }

  const codexText = existsSync(codexPath) ? readFileSync(codexPath, 'utf8') : ''
  const escapedCodexPath = codexScriptPath.replace(/\\/g, '\\\\')
  return {
    claude: { configured: claudeConfigured, settingsPath: claudePath },
    codex: {
      notifyConfigured: codexText.includes(codexScriptPath) || codexText.includes(escapedCodexPath) || codexText.includes(codexNotifyLine),
      otelConfigured: codexText.includes(`127.0.0.1:${port}/v1/logs`),
      configPath: codexPath
    }
  }
}

export function installClaudeHooks(hookDirectory: string, port: number): InstallResult {
  const { claudeScriptPath } = ensureHookScripts(hookDirectory, port)
  const settingsPath = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')
  const command = commandFor(claudeScriptPath)
  ensureParent(settingsPath)

  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    } catch (error) {
      return {
        ok: false,
        changed: false,
        path: settingsPath,
        message: `Cannot parse existing Claude settings.json: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  const hooks = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) as Record<string, unknown>
  let changed = false

  for (const eventName of CLAUDE_EVENTS) {
    const groups = Array.isArray(hooks[eventName]) ? (hooks[eventName] as Array<Record<string, unknown>>) : []
    const alreadyInstalled = groups.some((group) => {
      const handlers = Array.isArray(group.hooks) ? (group.hooks as Array<Record<string, unknown>>) : []
      return handlers.some((handler) => handler.command === command)
    })
    if (alreadyInstalled) continue

    const group: Record<string, unknown> = {
      hooks: [
        {
          type: 'command',
          command,
          timeout: 5
        }
      ]
    }
    if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(eventName)) group.matcher = '*'
    groups.push(group)
    hooks[eventName] = groups
    changed = true
  }

  settings.hooks = hooks
  const backupPath = changed ? backup(settingsPath) : undefined
  if (changed) writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')

  return {
    ok: true,
    changed,
    path: settingsPath,
    backupPath,
    message: changed ? 'Claude Code hooks installed. Restart Claude Code to verify them with /hooks.' : 'Claude Code hooks are already installed.'
  }
}

export function installCodexIntegration(hookDirectory: string, port: number): InstallResult {
  const { codexScriptPath } = ensureHookScripts(hookDirectory, port)
  const configPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
  ensureParent(configPath)

  let config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  const backupPath = backup(configPath)
  const notifyLine = `notify = [${tomlString('node')}, ${tomlString(codexScriptPath)}]`
  let changed = false

  if (/^\s*notify\s*=.*$/m.test(config)) {
    const replaced = config.replace(/^\s*notify\s*=.*$/m, notifyLine)
    if (replaced !== config) {
      config = replaced
      changed = true
    }
  } else {
    config = `${notifyLine}\n${config}`
    changed = true
  }

  const otelSnippet = `[otel]\nenvironment = "neural-observatory"\nlog_user_prompt = false\nexporter = { otlp-http = { endpoint = "http://127.0.0.1:${port}/v1/logs", protocol = "json" } }`
  let manualSnippet: string | undefined

  if (!/^\s*\[otel\]\s*$/m.test(config)) {
    config = `${config.trimEnd()}\n\n# Neural Observatory: local-only structured telemetry, prompts remain redacted.\n${otelSnippet}\n`
    changed = true
  } else if (!config.includes(`127.0.0.1:${port}/v1/logs`)) {
    manualSnippet = otelSnippet
  }

  if (changed) writeFileSync(configPath, config, 'utf8')

  return {
    ok: true,
    changed,
    path: configPath,
    backupPath,
    manualSnippet,
    message: manualSnippet
      ? 'Codex notify was installed, but an existing [otel] block was left untouched. Merge the shown snippet manually.'
      : changed
        ? 'Codex notify and local OpenTelemetry export were installed. Restart Codex.'
        : 'Codex integration is already installed.'
  }
}
