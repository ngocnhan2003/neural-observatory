import { randomUUID } from 'node:crypto'
import type { AIEvent, AIEventData, AIEventType, AIProvider } from '../../shared/events'

const sensitiveKey = /(prompt|content|message|output|input|text|arguments|tool_response|tool_input)/i

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function createEvent(
  provider: AIProvider,
  type: AIEventType,
  sessionId: string,
  data: AIEventData = {},
  timestamp = Date.now()
): AIEvent {
  return {
    id: randomUUID(),
    version: 1,
    provider,
    sessionId: sessionId || `${provider}-${timestamp}`,
    timestamp,
    type,
    data
  }
}

export function normalizeClaudeHook(payload: Record<string, unknown>): AIEvent[] {
  const hookName = String(payload.hook_event_name ?? payload.event_name ?? 'Unknown')
  const sessionId = String(payload.session_id ?? `claude-${Date.now()}`)
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : undefined
  const common: AIEventData = {
    cwd,
    toolName,
    rawEventName: hookName,
    measurement: 'measured'
  }

  switch (hookName) {
    case 'SessionStart':
      return [createEvent('claude-code', 'session.started', sessionId, { ...common, phase: 'waking' })]
    case 'UserPromptSubmit': {
      const promptLength = typeof payload.prompt === 'string' ? payload.prompt.length : 0
      return [
        createEvent('claude-code', 'prompt.submitted', sessionId, {
          ...common,
          phase: 'input',
          inputTokens: promptLength ? Math.max(1, Math.round(promptLength / 4)) : undefined,
          measurement: promptLength ? 'estimated' : 'measured'
        })
      ]
    }
    case 'PreToolUse':
      return [createEvent('claude-code', 'tool.started', sessionId, { ...common, phase: 'tool' })]
    case 'PostToolUse':
      return [createEvent('claude-code', 'tool.completed', sessionId, { ...common, phase: 'integration' })]
    case 'PostToolUseFailure':
      return [createEvent('claude-code', 'tool.failed', sessionId, { ...common, phase: 'error' })]
    case 'Stop':
      return [createEvent('claude-code', 'response.completed', sessionId, { ...common, phase: 'cooldown' })]
    case 'PreCompact':
      return [createEvent('claude-code', 'context.compacted', sessionId, { ...common, phase: 'memory' })]
    case 'SessionEnd':
      return [createEvent('claude-code', 'session.ended', sessionId, { ...common, phase: 'idle' })]
    case 'SubagentStart':
      return [
        createEvent('claude-code', 'tool.started', sessionId, {
          ...common,
          toolName: String(payload.agent_type ?? 'subagent'),
          phase: 'subagent'
        })
      ]
    case 'SubagentStop':
      return [
        createEvent('claude-code', 'tool.completed', sessionId, {
          ...common,
          toolName: String(payload.agent_type ?? 'subagent'),
          phase: 'integration'
        })
      ]
    case 'Notification':
      return [createEvent('claude-code', 'status', sessionId, { ...common, phase: 'attention' })]
    default:
      return [createEvent('claude-code', 'status', sessionId, common)]
  }
}

export function normalizeCodexNotify(payload: Record<string, unknown>): AIEvent[] {
  const sessionId = String(payload['thread-id'] ?? `codex-${Date.now()}`)
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined
  return [
    createEvent('codex', 'response.completed', sessionId, {
      cwd,
      phase: 'cooldown',
      rawEventName: String(payload.type ?? 'agent-turn-complete'),
      measurement: 'measured'
    })
  ]
}

type OtlpAnyValue = {
  stringValue?: string
  intValue?: string | number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values?: OtlpAnyValue[] }
  kvlistValue?: { values?: Array<{ key: string; value: OtlpAnyValue }> }
}

function unpackOtlpValue(value: OtlpAnyValue | undefined): unknown {
  if (!value) return undefined
  if (value.stringValue !== undefined) return value.stringValue
  if (value.intValue !== undefined) return numberValue(value.intValue) ?? value.intValue
  if (value.doubleValue !== undefined) return value.doubleValue
  if (value.boolValue !== undefined) return value.boolValue
  if (value.arrayValue?.values) return value.arrayValue.values.map(unpackOtlpValue)
  if (value.kvlistValue?.values) {
    return Object.fromEntries(value.kvlistValue.values.map((item) => [item.key, unpackOtlpValue(item.value)]))
  }
  return undefined
}

function findMetric(attrs: Record<string, unknown>, patterns: RegExp[]): number | undefined {
  for (const [key, value] of Object.entries(attrs)) {
    if (patterns.some((pattern) => pattern.test(key))) {
      const parsed = numberValue(value)
      if (parsed !== undefined) return parsed
    }
  }
  return undefined
}

function sanitizedAttributes(attrs: Record<string, unknown>): AIEventData {
  const safe: AIEventData = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (sensitiveKey.test(key)) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safe[key.replace(/[^a-zA-Z0-9_.-]/g, '_')] = value
    }
  }
  return safe
}

export function normalizeCodexOtlp(payload: Record<string, unknown>): AIEvent[] {
  const results: AIEvent[] = []
  const resourceLogs = Array.isArray(payload.resourceLogs) ? payload.resourceLogs : []

  for (const resourceLog of resourceLogs as Array<Record<string, unknown>>) {
    const resource = (resourceLog.resource ?? {}) as Record<string, unknown>
    const resourceAttrs = Array.isArray(resource.attributes) ? resource.attributes : []
    const resourceMap = Object.fromEntries(
      (resourceAttrs as Array<{ key: string; value: OtlpAnyValue }>).map((item) => [item.key, unpackOtlpValue(item.value)])
    )
    const scopeLogs = Array.isArray(resourceLog.scopeLogs) ? resourceLog.scopeLogs : []

    for (const scopeLog of scopeLogs as Array<Record<string, unknown>>) {
      const logRecords = Array.isArray(scopeLog.logRecords) ? scopeLog.logRecords : []
      for (const record of logRecords as Array<Record<string, unknown>>) {
        const attrsArray = Array.isArray(record.attributes) ? record.attributes : []
        const attrs = {
          ...resourceMap,
          ...Object.fromEntries(
            (attrsArray as Array<{ key: string; value: OtlpAnyValue }>).map((item) => [
              item.key,
              unpackOtlpValue(item.value)
            ])
          )
        }

        const body = unpackOtlpValue(record.body as OtlpAnyValue)
        const eventName = String(
          attrs['event.name'] ?? attrs['name'] ?? attrs['event_name'] ?? (typeof body === 'string' ? body : 'codex.event')
        )
        const sessionId = String(
          attrs['conversation.id'] ?? attrs['conversation_id'] ?? attrs['thread.id'] ?? attrs['thread_id'] ?? `codex-${Date.now()}`
        )
        const timestampNs = numberValue(record.timeUnixNano)
        const timestamp = timestampNs ? Math.floor(timestampNs / 1_000_000) : Date.now()
        const model = typeof attrs.model === 'string' ? attrs.model : undefined
        const safe = sanitizedAttributes(attrs)
        const base: AIEventData = {
          ...safe,
          model,
          rawEventName: eventName,
          measurement: 'measured'
        }

        if (eventName.includes('conversation_starts')) {
          results.push(createEvent('codex', 'session.started', sessionId, { ...base, phase: 'waking' }, timestamp))
          continue
        }
        if (eventName.includes('user_prompt')) {
          results.push(createEvent('codex', 'prompt.submitted', sessionId, { ...base, phase: 'input' }, timestamp))
          continue
        }
        if (eventName.includes('tool_decision')) {
          results.push(
            createEvent('codex', 'tool.started', sessionId, {
              ...base,
              phase: 'tool',
              toolName: String(attrs.tool ?? attrs.tool_name ?? 'tool')
            }, timestamp)
          )
          continue
        }
        if (eventName.includes('tool_result')) {
          const success = attrs.success !== false && attrs.status !== 'failed'
          results.push(
            createEvent('codex', success ? 'tool.completed' : 'tool.failed', sessionId, {
              ...base,
              phase: success ? 'integration' : 'error',
              toolName: String(attrs.tool ?? attrs.tool_name ?? 'tool'),
              latencyMs: findMetric(attrs, [/duration.*ms/i, /latency.*ms/i])
            }, timestamp)
          )
          continue
        }
        if (eventName.includes('api_request')) {
          results.push(
            createEvent('codex', 'response.started', sessionId, {
              ...base,
              phase: 'reasoning',
              latencyMs: findMetric(attrs, [/duration.*ms/i, /latency.*ms/i])
            }, timestamp)
          )
          continue
        }
        if (eventName.includes('sse_event') || eventName.includes('websocket_event')) {
          const kind = String(attrs.kind ?? attrs.event_kind ?? '')
          const inputTokens = findMetric(attrs, [/input.*token/i, /prompt.*token/i])
          const outputTokens = findMetric(attrs, [/output.*token/i, /completion.*token/i])
          const cachedTokens = findMetric(attrs, [/cache.*token/i])
          const totalTokens = findMetric(attrs, [/total.*token/i])

          if (kind.includes('response.completed') || inputTokens !== undefined || outputTokens !== undefined) {
            results.push(
              createEvent('codex', 'usage.updated', sessionId, {
                ...base,
                phase: 'output',
                inputTokens,
                outputTokens,
                cachedTokens,
                totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0)
              }, timestamp)
            )
          } else {
            results.push(
              createEvent('codex', 'token.activity', sessionId, {
                ...base,
                phase: 'output',
                tokenDelta: 1,
                status: kind,
                measurement: 'estimated'
              }, timestamp)
            )
          }
          continue
        }

        results.push(createEvent('codex', 'status', sessionId, base, timestamp))
      }
    }
  }

  return results
}

export function normalizeGenericEvent(payload: Record<string, unknown>): AIEvent[] {
  const provider = ['demo', 'claude-code', 'codex', 'openai'].includes(String(payload.provider))
    ? (String(payload.provider) as AIProvider)
    : 'openai'
  const type = String(payload.type ?? 'status') as AIEventType
  const timestamp = numberValue(payload.timestamp) ?? Date.now()
  const sessionId = String(payload.sessionId ?? `${provider}-${timestamp}`)
  const rawData = (payload.data ?? {}) as Record<string, unknown>
  const data: AIEventData = {}

  for (const [key, value] of Object.entries(rawData)) {
    if (sensitiveKey.test(key)) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') data[key] = value
  }

  return [createEvent(provider, type, sessionId, { ...data, measurement: data.measurement ?? 'measured' }, timestamp)]
}
