import { useEffect, useState } from 'react'
import type { AIEvent, BootstrapPayload } from '@shared/events'
import { useObservatoryStore } from '../store/useObservatoryStore'

interface TelemetryConnection {
  demoRunning: boolean
  setDemoRunning: (enabled: boolean) => Promise<void>
}

export function useTelemetry(): TelemetryConnection {
  const hydrate = useObservatoryStore((state) => state.hydrate)
  const ingest = useObservatoryStore((state) => state.ingest)
  const setConnected = useObservatoryStore((state) => state.setConnected)
  const tick = useObservatoryStore((state) => state.tick)
  const [demoRunning, setDemoState] = useState(true)

  useEffect(() => {
    let socket: WebSocket | null = null
    let disposed = false
    let reconnectTimer: number | undefined

    const connect = async (): Promise<void> => {
      try {
        const info = await window.neuralObservatory.getServerInfo()
        if (disposed) return
        setDemoState(info.demoRunning)

        const response = await fetch(`${info.baseUrl}/api/bootstrap`)
        if (response.ok) hydrate((await response.json()) as BootstrapPayload)

        socket = new WebSocket(info.websocketUrl)
        socket.addEventListener('open', () => setConnected(true))
        socket.addEventListener('message', (message) => {
          const payload = JSON.parse(String(message.data)) as {
            kind: string
            event?: AIEvent
          }
          if (payload.kind === 'event' && payload.event) ingest(payload.event)
          if (payload.kind === 'demo-state') setDemoState(Boolean((payload as { running?: boolean }).running))
          if (payload.kind === 'cleared') useObservatoryStore.getState().clearLocal()
        })
        socket.addEventListener('close', () => {
          setConnected(false)
          if (!disposed) reconnectTimer = window.setTimeout(() => void connect(), 1300)
        })
        socket.addEventListener('error', () => socket?.close())
      } catch {
        setConnected(false)
        if (!disposed) reconnectTimer = window.setTimeout(() => void connect(), 1800)
      }
    }

    void connect()
    const tickTimer = window.setInterval(tick, 120)

    return () => {
      disposed = true
      window.clearInterval(tickTimer)
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [hydrate, ingest, setConnected, tick])

  return {
    demoRunning,
    setDemoRunning: async (enabled: boolean) => {
      const running = await window.neuralObservatory.setDemo(enabled)
      setDemoState(running)
    }
  }
}
