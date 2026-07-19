import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ActivityPoint } from '../store/useObservatoryStore'

export function ActivityChart({ data }: { data: ActivityPoint[] }): React.JSX.Element {
  return (
    <div className="chart-card panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">LIVE SIGNAL</span>
          <h2>Activity waveform</h2>
        </div>
        <span className="panel-note">3s token window</span>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: -20, right: 4, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#72e7ff" stopOpacity={0.46} />
                <stop offset="100%" stopColor="#72e7ff" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              contentStyle={{ background: '#0a1019', border: '1px solid rgba(140,220,255,.16)', borderRadius: 10 }}
              labelStyle={{ color: '#91a1b8' }}
            />
            <Area
              type="monotone"
              dataKey="activity"
              stroke="#79e6ff"
              strokeWidth={1.8}
              fill="url(#activityFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
