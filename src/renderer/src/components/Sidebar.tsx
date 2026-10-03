import FileTree from './panels/FileTree'
import OutlinePanel from './panels/OutlinePanel'
import SearchPanel from './panels/SearchPanel'
import SymbolsPanel from './panels/SymbolsPanel'
import Copilot from './Copilot'
import ChatPanel from './panels/ChatPanel'
import { useApp } from '../store'

export default function Sidebar(): React.JSX.Element {
  const inSession = useApp((s) => s.collab.active && !s.collab.joining)
  // Discussion fermée en fin de session : retour aux fichiers
  const current = useApp((s) => s.panel)
  const panel = current === 'chat' && !inSession ? 'files' : current
  return (
    <div className="sidebar-inner">
      {panel === 'files' && <FileTree />}
      {panel === 'outline' && <OutlinePanel />}
      {panel === 'symbols' && <SymbolsPanel />}
      {panel === 'search' && <SearchPanel />}
      {panel === 'chat' && <ChatPanel />}
      <Copilot />
    </div>
  )
}
