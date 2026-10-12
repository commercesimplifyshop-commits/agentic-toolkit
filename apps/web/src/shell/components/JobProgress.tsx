import type { Job } from '../api'

const ICON = { pending: '·', running: '', done: '✓', error: '✕', skipped: '–' }

export function JobProgress({ job }: { job: Job }) {
  return (
    <div>
      {job.steps.map((s) => (
        <div key={s.id} className="sf-check">
          <span className={`ic ${s.status === 'done' ? 'ok' : s.status === 'error' ? 'no' : s.status === 'running' ? 'run' : 'hint'}`}>
            {s.status === 'running' ? <span className="sf-spinner" style={{ width: 10, height: 10 }} /> : ICON[s.status]}
          </span>
          <span style={{ color: s.status === 'pending' ? 'var(--sf-faint)' : undefined }}>{s.label}</span>
          {s.detail && <span className="det">{s.detail}</span>}
        </div>
      ))}
      {job.status === 'running' && job.log.length > 0 && (
        <div className="sf-mono sf-faint" style={{ marginTop: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {job.log[job.log.length - 1]}
        </div>
      )}
      {job.error && <div className="sf-error">{job.error}</div>}
    </div>
  )
}
