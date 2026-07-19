import { create } from 'zustand'
import type { AIEvent, AIProvider, BootstrapPayload, MeasurementKind } from '@shared/events'

export interface ActivityPoint {
  time: string
  activity: number
  tokenRate: number
  tools: number
}

interface ObservatoryState {
  connected: boolean
  serverVersion: string
  provider: AIProvider
  phase: string
  measurement: MeasurementKind
  activity: number
  toolPulse: number
  errorPulse: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  totalTokens: number
  contextPercent: number
  tokenRate: number
  activeTools: number
  latencyMs: number
  sessionCount: number
  events: AIEvent[]
  history: ActivityPoint[]
  hydrate: (payload: BootstrapPayload) => void
  ingest: (event: AIEvent) => void
  setConnected: (connected: boolean) => void
  tick: () => void
  clearLocal: () => void
}

let tokenSamples: Array<{ timestamp: number; amount: number }> = []
let lastHistoryAt = 0
let lastRealEventAt = 0

function phaseFor(event: AIEvent): string {
  if (event.data.phase) return event.data.phase
  switch (event.type) {
    case 'session.started':
      return 'waking'
    case 'prompt.submitted':
      return 'input'
    case 'response.started':
      return 'reasoning'
    case 'token.activity':
    case 'usage.updated':
      return 'output'
    case 'tool.started':
      return 'tool'
    case 'tool.completed':
      return 'integration'
    case 'context.compacted':
      return 'memory'
    case 'error':
    case 'tool.failed':
      return 'error'
    case 'response.completed':
      return 'cooldown'
    default:
      return 'idle'
  }
}

export const useObservatoryStore = create<ObservatoryState>((set, get) => ({
  connected: false,
  serverVersion: '0.1.0',
  provider: 'demo',
  phase: 'idle',
  measurement: 'decorative',
  activity: 0.12,
  toolPulse: 0,
  errorPulse: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  contextPercent: 0,
  tokenRate: 0,
  activeTools: 0,
  latencyMs: 0,
  sessionCount: 0,
  events: [],
  history: [],

  hydrate: (payload) => {
    set({ serverVersion: payload.serverVersion, sessionCount: 0, events: [] })
    for (const event of payload.events.slice(-120)) get().ingest(event)
    set({ sessionCount: payload.stats.sessionCount })
  },

  ingest: (event) => {
    const now = Date.now()
    if (event.provider !== 'demo') lastRealEventAt = now
    if (event.provider === 'demo' && now - lastRealEventAt < 10_000) return

    const current = get()
    const data = event.data
    const next: Partial<ObservatoryState> = {
      provider: event.provider,
      phase: phaseFor(event),
      measurement: data.measurement ?? 'measured',
      events: [...current.events, event].slice(-90)
    }

    switch (event.type) {
      case 'session.started':
        next.sessionCount = current.sessionCount + 1
        next.activity = Math.max(current.activity, 0.58)
        break
      case 'session.ended':
        next.activity = 0.16
        next.activeTools = 0
        break
      case 'prompt.submitted':
        next.activity = 0.78
        if (data.inputTokens !== undefined) next.inputTokens = data.inputTokens
        break
      case 'response.started':
        next.activity = Math.max(current.activity, 0.7)
        if (data.latencyMs !== undefined) next.latencyMs = data.latencyMs
        break
      case 'token.activity': {
        const amount = Math.max(1, data.tokenDelta ?? 1)
        tokenSamples.push({ timestamp: event.timestamp, amount })
        next.outputTokens = current.outputTokens + amount
        next.totalTokens = current.inputTokens + current.outputTokens + amount
        next.activity = Math.min(1, current.activity + 0.12)
        break
      }
      case 'usage.updated': {
        const previousOutput = current.outputTokens
        if (data.inputTokens !== undefined) next.inputTokens = data.inputTokens
        if (data.outputTokens !== undefined) next.outputTokens = data.outputTokens
        if (data.cachedTokens !== undefined) next.cachedTokens = data.cachedTokens
        if (data.totalTokens !== undefined) next.totalTokens = data.totalTokens
        if (data.contextPercent !== undefined) next.contextPercent = data.contextPercent
        if (data.outputTokens !== undefined && data.outputTokens > previousOutput) {
          tokenSamples.push({ timestamp: event.timestamp, amount: data.outputTokens - previousOutput })
        }
        next.activity = Math.min(1, current.activity + 0.18)
        break
      }
      case 'tool.started':
        next.activeTools = current.activeTools + 1
        next.toolPulse = 1
        next.activity = 0.94
        break
      case 'tool.completed':
        next.activeTools = Math.max(0, current.activeTools - 1)
        next.toolPulse = 0.75
        next.activity = 0.82
        if (data.latencyMs !== undefined) next.latencyMs = data.latencyMs
        break
      case 'tool.failed':
      case 'error':
        next.activeTools = Math.max(0, current.activeTools - 1)
        next.errorPulse = 1
        next.activity = 1
        break
      case 'context.compacted':
        next.activity = 0.88
        next.contextPercent = Math.max(8, current.contextPercent * 0.44)
        break
      case 'response.completed':
        next.activity = Math.max(0.38, current.activity * 0.72)
        if (data.latencyMs !== undefined) next.latencyMs = data.latencyMs
        break
      default:
        next.activity = Math.max(current.activity, 0.36)
    }

    set(next)
  },

  setConnected: (connected) => set({ connected }),

  tick: () => {
    const now = Date.now()
    tokenSamples = tokenSamples.filter((sample) => now - sample.timestamp <= 3000)
    const rate = tokenSamples.reduce((sum, sample) => sum + sample.amount, 0) / 3
    const current = get()
    const decayedActivity = Math.max(
      current.phase === 'idle' ? 0.1 : 0.18,
      current.activity * (current.activeTools > 0 ? 0.985 : 0.955)
    )

    const update: Partial<ObservatoryState> = {
      tokenRate: rate,
      activity: decayedActivity,
      toolPulse: current.toolPulse * 0.9,
      errorPulse: current.errorPulse * 0.86
    }

    if (now - lastHistoryAt >= 1000) {
      lastHistoryAt = now
      update.history = [
        ...current.history,
        {
          time: new Date(now).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
          activity: Math.round(decayedActivity * 100),
          tokenRate: Math.round(rate),
          tools: current.activeTools
        }
      ].slice(-36)
    }

    set(update)
  },

  clearLocal: () => {
    tokenSamples = []
    set({
      events: [],
      history: [],
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      contextPercent: 0,
      tokenRate: 0,
      activeTools: 0,
      latencyMs: 0,
      sessionCount: 0,
      activity: 0.12,
      phase: 'idle'
    })
  }
}))
