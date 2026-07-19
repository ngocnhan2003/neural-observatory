import {
  Activity,
  AlertTriangle,
  Braces,
  CheckCircle2,
  CircleDot,
  Cpu,
  DatabaseZap,
  MessageSquareText,
  Wrench
} from 'lucide-react'
import type { AIEvent } from '@shared/events'

const iconFor = (event: AIEvent): React.JSX.Element => {
  const props = { size: 14, strokeWidth: 1.8 }
  if (event.type === 'tool.started') return <Wrench {...props} />
  if (event.type === 'tool.completed') return <CheckCircle2 {...props} />
  if (event.type === 'tool.failed' || event.type === 'error') return <AlertTriangle {...props} />
  if (event.type === 'prompt.submitted') return <MessageSquareText {...props} />
  if (event.type === 'usage.updated' || event.type === 'token.activity') return <DatabaseZap {...props} />
  if (event.type.startsWith('session')) return <Cpu {...props} />
  if (event.type.startsWith('response')) return <Braces {...props} />
  return <CircleDot {...props} />
}

function titleFor(event: AIEvent): string {
  switch (event.type) {
    case 'tool.started':
      return `${event.data.toolName ?? 'Tool'} started`
    case 'tool.completed':
      return `${event.data.toolName ?? 'Tool'} completed`
    case 'tool.failed':
      return `${event.data.toolName ?? 'Tool'} failed`
    case 'usage.updated':
      return `Usage ${Math.round(event.data.totalTokens ?? 0).toLocaleString()} tokens`
    case 'token.activity':
      return `Token pulse +${event.data.tokenDelta ?? 1}`
    case 'prompt.submitted':
      return 'Prompt submitted'
    case 'session.started':
      return 'Session awakened'
    case 'session.ended':
      return 'Session dormant'
    case 'response.started':
      return 'Model response started'
    case 'response.completed':
      return 'Turn completed'
    case 'context.compacted':
      return 'Context compacted'
    default:
      return event.data.rawEventName ?? event.type
  }
}

export function EventFeed({ events }: { events: AIEvent[] }): React.JSX.Element {
  return (
    <section className="event-feed panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">EVENT BUS</span>
          <h2>Recent signals</h2>
        </div>
        <Activity size={16} />
      </div>
      <div className="event-list">
        {[...events].reverse().slice(0, 16).map((event) => (
          <div className={`event-row event-row--${event.type.includes('failed') || event.type === 'error' ? 'error' : 'normal'}`} key={event.id}>
            <div className="event-row__icon">{iconFor(event)}</div>
            <div className="event-row__body">
              <strong>{titleFor(event)}</strong>
              <span>{event.provider} · {new Date(event.timestamp).toLocaleTimeString()}</span>
            </div>
            <span className={`measure-tag measure-tag--${event.data.measurement ?? 'measured'}`}>
              {event.data.measurement ?? 'measured'}
            </span>
          </div>
        ))}
        {events.length === 0 && <div className="empty-state">No signals yet.</div>}
      </div>
    </section>
  )
}
