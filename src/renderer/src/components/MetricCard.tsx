import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  tone?: 'cyan' | 'violet' | 'green' | 'amber'
}

export function MetricCard({ label, value, detail, icon: Icon, tone = 'cyan' }: MetricCardProps): React.JSX.Element {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__icon"><Icon size={17} strokeWidth={1.7} /></div>
      <div>
        <div className="metric-card__label">{label}</div>
        <div className="metric-card__value">{value}</div>
        <div className="metric-card__detail">{detail}</div>
      </div>
    </article>
  )
}
