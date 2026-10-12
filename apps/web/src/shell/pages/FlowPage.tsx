import { useParams } from 'react-router-dom'
import { FlowApp } from '../../FlowApp'

/** Hosts the 3D purchase flow (and its debugger) inside the dashboard. */
export function FlowPage({ mode }: { mode: 'flow' | 'debug' }) {
  const { id = '' } = useParams()
  return (
    <div className="sf-flow-host">
      <FlowApp key={`${id}-${mode}`} workspaceId={id} mode={mode} />
    </div>
  )
}
