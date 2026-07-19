import { useState } from 'react'
import {
  Activity,
  BrainCircuit,
  ArrowDownToLine,
  Database,
  Gauge,
  HardDrive,
  Pause,
  Play,
  Radio,
  RotateCcw,
  TimerReset,
  Wrench
} from 'lucide-react'
import { BrainScene } from './components/BrainScene'
import { MetricCard } from './components/MetricCard'
import { ActivityChart } from './components/ActivityChart'
import { EventFeed } from './components/EventFeed'
import { IntegrationPanel } from './components/IntegrationPanel'
import { useTelemetry } from './hooks/useTelemetry'
import { useObservatoryStore } from './store/useObservatoryStore'

const providerLabel = {
  demo: 'Simulation',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  openai: 'OpenAI'
} as const

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return Math.round(value).toLocaleString()
}

function App(): React.JSX.Element {
  const telemetry = useTelemetry()
  const state = useObservatoryStore()
  const [showIntegrations, setShowIntegrations] = useState(false)

  const clearHistory = async (): Promise<void> => {
    await window.neuralObservatory.clearHistory()
    state.clearLocal()
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><BrainCircuit size={24} /></div>
          <div>
            <strong>NEURAL OBSERVATORY</strong>
            <span>Local AI telemetry · v{state.serverVersion}</span>
          </div>
        </div>

        <div className="topbar-center">
          <div className={`connection-pill ${state.connected ? 'connection-pill--online' : 'connection-pill--offline'}`}>
            <span className="connection-dot" />
            {state.connected ? 'Event bridge online' : 'Reconnecting'}
          </div>
          <div className="provider-pill"><Radio size={14} /> {providerLabel[state.provider]}</div>
          <div className="phase-pill">{state.phase.toUpperCase()}</div>
        </div>

        <div className="topbar-actions">
          <button className="button button--ghost" onClick={() => void telemetry.setDemoRunning(!telemetry.demoRunning)}>
            {telemetry.demoRunning ? <Pause size={14} /> : <Play size={14} />}
            Demo
          </button>
          <button className="button button--ghost" onClick={() => setShowIntegrations((value) => !value)}>
            <Wrench size={14} /> Integrations
          </button>
          <button className="icon-button" onClick={() => void clearHistory()} title="Clear history">
            <RotateCcw size={15} />
          </button>
        </div>
      </header>

      <section className="dashboard-grid">
        <aside className="left-rail">
          <div className="rail-heading">
            <span className="eyebrow">OBSERVATORY</span>
            <h1>Live cognition signal</h1>
            <p>Measured telemetry drives the dashboard. The neural anatomy is intentionally decorative.</p>
          </div>

          <div className="metric-stack">
            <MetricCard
              label="Output velocity"
              value={`${state.tokenRate.toFixed(state.tokenRate < 10 ? 1 : 0)} tok/s`}
              detail={`${formatTokens(state.outputTokens)} output tokens`}
              icon={Gauge}
              tone="cyan"
            />
            <MetricCard
              label="Context pressure"
              value={`${Math.round(state.contextPercent)}%`}
              detail={`${formatTokens(state.totalTokens)} observed tokens`}
              icon={Database}
              tone="violet"
            />
            <MetricCard
              label="Tool activity"
              value={`${state.activeTools} active`}
              detail={`${state.events.filter((event) => event.type === 'tool.started').length} calls in view`}
              icon={Wrench}
              tone="green"
            />
            <MetricCard
              label="Last latency"
              value={state.latencyMs ? `${Math.round(state.latencyMs)} ms` : '—'}
              detail={`${state.sessionCount} observed sessions`}
              icon={TimerReset}
              tone="amber"
            />
          </div>

          <div className="legend-card panel">
            <span className="eyebrow">TRUST LABELS</span>
            <div className="legend-row"><span className="legend-dot legend-dot--measured" />Measured <small>provider event</small></div>
            <div className="legend-row"><span className="legend-dot legend-dot--estimated" />Estimated <small>derived locally</small></div>
            <div className="legend-row"><span className="legend-dot legend-dot--decorative" />Decorative <small>visual metaphor</small></div>
          </div>
        </aside>

        <section className="brain-stage panel">
          <BrainScene
            activity={state.activity}
            toolPulse={state.toolPulse}
            errorPulse={state.errorPulse}
            provider={state.provider}
            phase={state.phase}
          />

          <div className="brain-stage__header">
            <div>
              <span className="eyebrow">NEURAL FIELD 01</span>
              <h2>{providerLabel[state.provider]} activity</h2>
            </div>
            <span className={`measure-tag measure-tag--${state.measurement}`}>{state.measurement}</span>
          </div>

          <div className="brain-stage__footer">
            <div className="signal-stat">
              <Activity size={15} />
              <span>Activity</span>
              <strong>{Math.round(state.activity * 100)}%</strong>
            </div>
            <div className="signal-stat">
              <HardDrive size={15} />
              <span>Cache</span>
              <strong>{formatTokens(state.cachedTokens)}</strong>
            </div>
            <div className="signal-stat">
              <ArrowDownToLine size={15} />
              <span>Input stream</span>
              <strong>{formatTokens(state.inputTokens)}</strong>
            </div>
          </div>
        </section>

        <aside className="right-rail">
          {showIntegrations ? <IntegrationPanel /> : <EventFeed events={state.events} />}
          <ActivityChart data={state.history} />
        </aside>
      </section>

      <footer className="statusbar">
        <span><span className="status-led" /> localhost only</span>
        <span>Prompt content storage: OFF</span>
        <span>Renderer: WebGL</span>
        <span>{state.events.length} events in view</span>
      </footer>
    </main>
  )
}

export default App
