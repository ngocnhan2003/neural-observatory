import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { z } from 'zod'
import type { AddressInfo } from 'node:net'
import type { AIEvent, BootstrapPayload } from '../../shared/events'
import { EventStore } from './event-store'
import {
  normalizeClaudeHook,
  normalizeCodexNotify,
  normalizeCodexOtlp,
  normalizeGenericEvent
} from './normalizers'

const jsonObject = z.record(z.string(), z.unknown())
const MAX_BODY_BYTES = 2 * 1024 * 1024

export class TelemetryServer {
  private readonly clients = new Set<WebSocket>()
  private readonly server = createServer((request, response) => void this.route(request, response))
  private readonly websocketServer = new WebSocketServer({ noServer: true })
  private demoTimer: NodeJS.Timeout | null = null
  private demoSessionId = `demo-${Date.now()}`
  private demoOutputTokens = 0
  private demoInputTokens = 8420
  private demoTick = 0
  private port = 4319

  constructor(private readonly store: EventStore) {
    this.server.on('upgrade', (request, socket, head) => {
      if (request.url !== '/ws') {
        socket.destroy()
        return
      }
      this.websocketServer.handleUpgrade(request, socket, head, (client) => {
        this.websocketServer.emit('connection', client, request)
      })
    })

    this.websocketServer.on('connection', (client) => {
      this.clients.add(client)
      client.on('close', () => this.clients.delete(client))
      client.send(JSON.stringify({ kind: 'connected', version: '0.1.0' }))
    })
  }

  async start(preferredPort = 4319): Promise<number> {
    const listen = (port: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const onListening = (): void => {
          this.server.off('error', onError)
          resolve()
        }
        const onError = (error: NodeJS.ErrnoException): void => {
          this.server.off('listening', onListening)
          reject(error)
        }
        this.server.once('listening', onListening)
        this.server.once('error', onError)
        this.server.listen(port, '127.0.0.1')
      })

    try {
      await listen(preferredPort)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || preferredPort === 0) throw error
      await listen(0)
    }

    this.port = (this.server.address() as AddressInfo).port
    return this.port
  }

  getPort(): number {
    return this.port
  }

  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  startDemo(): void {
    if (this.demoTimer) return

    this.demoSessionId = `demo-${Date.now()}`
    this.demoOutputTokens = 0
    this.demoTick = 0
    this.publish(this.demoEvent('session.started', { phase: 'waking', measurement: 'decorative' }))
    this.publish(this.demoEvent('prompt.submitted', { phase: 'input', inputTokens: this.demoInputTokens, measurement: 'decorative' }))

    this.broadcast({ kind: 'demo-state', running: true })

    this.demoTimer = setInterval(() => {
      this.demoTick += 1
      const tokenDelta = 2 + Math.floor(Math.random() * 7)
      this.demoOutputTokens += tokenDelta
      this.publish(
        this.demoEvent('token.activity', {
          phase: 'output',
          tokenDelta,
          measurement: 'decorative'
        })
      )

      if (this.demoTick % 8 === 0) {
        this.publish(
          this.demoEvent('usage.updated', {
            phase: 'output',
            inputTokens: this.demoInputTokens,
            outputTokens: this.demoOutputTokens,
            totalTokens: this.demoInputTokens + this.demoOutputTokens,
            contextPercent: Math.min(96, 26 + this.demoOutputTokens / 95),
            measurement: 'decorative'
          })
        )
      }

      if (this.demoTick % 24 === 4) {
        const tools = ['Read', 'Bash', 'Edit', 'Search', 'MCP']
        const toolName = tools[Math.floor(Math.random() * tools.length)]
        this.publish(this.demoEvent('tool.started', { phase: 'tool', toolName, measurement: 'decorative' }))
        setTimeout(() => {
          this.publish(
            this.demoEvent('tool.completed', {
              phase: 'integration',
              toolName,
              latencyMs: 180 + Math.floor(Math.random() * 1700),
              measurement: 'decorative'
            })
          )
        }, 900 + Math.floor(Math.random() * 1000))
      }
    }, 260)
  }

  stopDemo(): void {
    if (!this.demoTimer) return
    clearInterval(this.demoTimer)
    this.demoTimer = null
    this.broadcast({ kind: 'demo-state', running: false })
    this.publish(this.demoEvent('response.completed', { phase: 'cooldown', measurement: 'decorative' }))
    this.publish(this.demoEvent('session.ended', { phase: 'idle', measurement: 'decorative' }))
  }

  isDemoRunning(): boolean {
    return this.demoTimer !== null
  }

  clear(): void {
    this.store.clear()
    this.broadcast({ kind: 'cleared' })
  }

  async close(): Promise<void> {
    this.stopDemo()
    for (const client of this.clients) client.close()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private demoEvent(type: AIEvent['type'], data: AIEvent['data']): AIEvent {
    return {
      id: randomUUID(),
      version: 1,
      provider: 'demo',
      sessionId: this.demoSessionId,
      timestamp: Date.now(),
      type,
      data
    }
  }

  private publish(event: AIEvent): void {
    if (event.provider !== 'demo' && this.demoTimer) {
      clearInterval(this.demoTimer)
      this.demoTimer = null
      this.broadcast({ kind: 'demo-state', running: false })
    }
    this.store.insert(event)
    this.broadcast({ kind: 'event', event })
  }

  private publishMany(events: AIEvent[]): void {
    for (const event of events) this.publish(event)
  }

  private broadcast(payload: unknown): void {
    const encoded = JSON.stringify(payload)
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(encoded)
    }
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.getBaseUrl())

    if (request.method === 'OPTIONS') {
      this.sendJson(response, 204, {})
      return
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      this.sendJson(response, 200, { ok: true, port: this.port, demo: this.isDemoRunning() })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      const payload: BootstrapPayload = {
        events: this.store.recent(160).reverse(),
        stats: this.store.stats(),
        serverVersion: '0.1.0'
      }
      this.sendJson(response, 200, payload)
      return
    }

    if (request.method === 'POST' && url.pathname === '/hooks/claude') {
      const body = await this.readJson(request, response)
      if (!body) return
      this.publishMany(normalizeClaudeHook(body))
      this.sendJson(response, 200, { suppressOutput: true })
      return
    }

    if (request.method === 'POST' && url.pathname === '/hooks/codex') {
      const body = await this.readJson(request, response)
      if (!body) return
      this.publishMany(normalizeCodexNotify(body))
      this.sendJson(response, 202, { accepted: true })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/logs') {
      const body = await this.readJson(request, response)
      if (!body) return
      this.publishMany(normalizeCodexOtlp(body))
      this.sendJson(response, 200, { partialSuccess: {} })
      return
    }

    if (request.method === 'POST' && url.pathname === '/events') {
      const body = await this.readJson(request, response)
      if (!body) return
      this.publishMany(normalizeGenericEvent(body))
      this.sendJson(response, 202, { accepted: true })
      return
    }

    this.sendJson(response, 404, { error: 'Not found' })
  }

  private async readJson(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<Record<string, unknown> | null> {
    try {
      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += buffer.length
        if (total > MAX_BODY_BYTES) {
          this.sendJson(response, 413, { error: 'Payload too large' })
          return null
        }
        chunks.push(buffer)
      }

      const decoded = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      const parsed = jsonObject.safeParse(decoded)
      if (!parsed.success) {
        this.sendJson(response, 400, { error: 'Expected a JSON object' })
        return null
      }
      return parsed.data
    } catch (error) {
      this.sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON' })
      return null
    }
  }

  private sendJson(response: ServerResponse, status: number, value: unknown): void {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'content-type')
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    response.end(status === 204 ? undefined : JSON.stringify(value))
  }
}
