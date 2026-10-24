import { Folder, GitBranch } from 'lucide-react'
import { workspaceName } from './session-format'

export function SessionOrigin({ workspace, branch }: { workspace: string | null; branch: string | null }) {
  return <span className="session-origin">
    {workspace ? <span className="session-origin__workspace" title={workspace}><Folder aria-hidden="true" /><span>{workspaceName(workspace)}</span></span> : null}
    {branch ? <span className="session-origin__branch" title={branch}><GitBranch aria-hidden="true" /><span>{branch}</span></span> : null}
  </span>
}
