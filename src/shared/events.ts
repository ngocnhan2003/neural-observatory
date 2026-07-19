export type AIProvider = 'demo' | 'claude-code' | 'codex' | 'openai'

export type MeasurementKind = 'measured' | 'estimated' | 'decorative'

export type AIEventType =
  | 'session.started'
  | 'session.ended'
  | 'prompt.submitted'
  | 'response.started'
  | 'response.completed'
  | 'token.activity'
  | 'usage.updated'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'context.compacted'
  | 'status'
  | 'error'

export interface AIEventData {
  model?: string
  toolName?: string
  status?: string
  phase?: string
  cwd?: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  totalTokens?: number
  contextPercent?: number
  tokenDelta?: number
  message?: string
  measurement?: MeasurementKind
  rawEventName?: string
  [key: string]: string | number | boolean | undefined
}

export interface AIEvent {
  id: string
  version: 1
  provider: AIProvider
  sessionId: string
  timestamp: number
  type: AIEventType
  data: AIEventData
}

export interface PersistedStats {
  eventCount: number
  sessionCount: number
  inputTokens: number
  outputTokens: number
  toolCalls: number
  errorCount: number
}

export interface BootstrapPayload {
  events: AIEvent[]
  stats: PersistedStats
  serverVersion: string
}

export interface IntegrationStatus {
  claude: {
    configured: boolean
    settingsPath: string
  }
  codex: {
    notifyConfigured: boolean
    otelConfigured: boolean
    configPath: string
  }
}

export interface InstallResult {
  ok: boolean
  changed: boolean
  message: string
  path: string
  backupPath?: string
  manualSnippet?: string
}
