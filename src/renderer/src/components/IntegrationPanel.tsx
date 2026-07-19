import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, PlugZap, RefreshCw, ShieldCheck, TerminalSquare } from 'lucide-react'
import type { InstallResult, IntegrationStatus } from '@shared/events'

export function IntegrationPanel(): React.JSX.Element {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [result, setResult] = useState<InstallResult | null>(null)
  const [busy, setBusy] = useState<'claude' | 'codex' | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = async (): Promise<void> => {
    setStatus(await window.neuralObservatory.getIntegrations())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const install = async (provider: 'claude' | 'codex'): Promise<void> => {
    setBusy(provider)
    setResult(null)
    try {
      const installResult = provider === 'claude'
        ? await window.neuralObservatory.installClaude()
        : await window.neuralObservatory.installCodex()
      setResult(installResult)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const copySnippet = async (): Promise<void> => {
    if (!result?.manualSnippet) return
    await navigator.clipboard.writeText(result.manualSnippet)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1300)
  }

  return (
    <section className="integration-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CONNECTORS</span>
          <h2>Local integrations</h2>
        </div>
        <button className="icon-button" onClick={() => void refresh()} title="Refresh status"><RefreshCw size={15} /></button>
      </div>

      <div className="connector-list">
        <div className="connector-row">
          <div className="connector-logo connector-logo--claude"><TerminalSquare size={18} /></div>
          <div className="connector-copy">
            <strong>Claude Code</strong>
            <span>{status?.claude.configured ? 'Lifecycle and tool hooks active' : 'Command hooks not installed'}</span>
          </div>
          <button className={status?.claude.configured ? 'button button--success' : 'button'} onClick={() => void install('claude')} disabled={busy !== null}>
            {status?.claude.configured ? <><Check size={14} /> Connected</> : busy === 'claude' ? 'Installing…' : <><PlugZap size={14} /> Install</>}
          </button>
        </div>

        <div className="connector-row">
          <div className="connector-logo connector-logo--codex"><CpuGlyph /></div>
          <div className="connector-copy">
            <strong>Codex / OpenAI</strong>
            <span>{status?.codex.otelConfigured ? 'OTel JSON and notify active' : status?.codex.notifyConfigured ? 'Notify active; OTel needs merge' : 'Not configured'}</span>
          </div>
          <button className={status?.codex.otelConfigured ? 'button button--success' : 'button'} onClick={() => void install('codex')} disabled={busy !== null}>
            {status?.codex.otelConfigured ? <><Check size={14} /> Connected</> : busy === 'codex' ? 'Installing…' : <><PlugZap size={14} /> Install</>}
          </button>
        </div>
      </div>

      <div className="privacy-line"><ShieldCheck size={14} /> Prompt bodies are redacted and never stored by default.</div>

      {result && (
        <div className={`install-result ${result.ok ? 'install-result--ok' : 'install-result--error'}`}>
          <strong>{result.ok ? 'Integration updated' : 'Integration error'}</strong>
          <p>{result.message}</p>
          <button className="text-button" onClick={() => void window.neuralObservatory.openPath(result.path)}>
            Open config <ExternalLink size={13} />
          </button>
          {result.manualSnippet && (
            <div className="snippet-box">
              <pre>{result.manualSnippet}</pre>
              <button className="icon-button snippet-copy" onClick={() => void copySnippet()} title="Copy config">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function CpuGlyph(): React.JSX.Element {
  return <span className="cpu-glyph">⌁</span>
}
