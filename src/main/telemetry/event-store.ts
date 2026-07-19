import { DatabaseSync } from 'node:sqlite'
import type { AIEvent, PersistedStats } from '../../shared/events'

export class EventStore {
  private db: DatabaseSync | null = null
  private memory: AIEvent[] = []

  constructor(databasePath: string) {
    try {
      this.db = new DatabaseSync(databasePath)
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          provider TEXT NOT NULL,
          session_id TEXT NOT NULL,
          type TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp DESC);
      `)
    } catch (error) {
      console.warn('[EventStore] SQLite unavailable; using in-memory fallback.', error)
      this.db = null
    }
  }

  insert(event: AIEvent): void {
    if (!this.db) {
      this.memory.push(event)
      if (this.memory.length > 5000) this.memory.shift()
      return
    }

    this.db
      .prepare(
        `INSERT OR REPLACE INTO events(id, timestamp, provider, session_id, type, payload)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.timestamp,
        event.provider,
        event.sessionId,
        event.type,
        JSON.stringify(event)
      )
  }

  recent(limit = 120): AIEvent[] {
    if (!this.db) return this.memory.slice(-limit).reverse()

    const rows = this.db
      .prepare('SELECT payload FROM events ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as unknown as Array<{ payload: string }>

    return rows.map((row) => JSON.parse(row.payload) as AIEvent)
  }

  stats(): PersistedStats {
    const empty: PersistedStats = {
      eventCount: 0,
      sessionCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
      errorCount: 0
    }

    if (!this.db) return this.reduceStats(this.memory, empty)

    const rows = this.db.prepare('SELECT payload FROM events').all() as unknown as Array<{ payload: string }>
    return this.reduceStats(
      rows.map((row) => JSON.parse(row.payload) as AIEvent),
      empty
    )
  }

  clear(): void {
    if (!this.db) {
      this.memory = []
      return
    }
    this.db.exec('DELETE FROM events; VACUUM;')
  }

  close(): void {
    this.db?.close()
  }

  private reduceStats(events: AIEvent[], initial: PersistedStats): PersistedStats {
    const sessions = new Set<string>()
    const usageBySession = new Map<string, { input: number; output: number }>()
    const stats = { ...initial }

    for (const event of events) {
      stats.eventCount += 1
      sessions.add(event.sessionId)
      if (event.type === 'usage.updated') {
        const previous = usageBySession.get(event.sessionId) ?? { input: 0, output: 0 }
        usageBySession.set(event.sessionId, {
          input: Math.max(previous.input, Number(event.data.inputTokens ?? 0)),
          output: Math.max(previous.output, Number(event.data.outputTokens ?? 0))
        })
      }
      if (event.type === 'tool.started') stats.toolCalls += 1
      if (event.type === 'error' || event.type === 'tool.failed') stats.errorCount += 1
    }

    for (const usage of usageBySession.values()) {
      stats.inputTokens += usage.input
      stats.outputTokens += usage.output
    }
    stats.sessionCount = sessions.size
    return stats
  }
}
