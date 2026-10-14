import FileTree from './panels/FileTree'
import OutlinePanel from './panels/OutlinePanel'
import SearchPanel from './panels/SearchPanel'
import SymbolsPanel from './panels/SymbolsPanel'
import Copilot from './Copilot'
import ChatPanel from './panels/ChatPanel'
import ExtensionsPanel from './panels/ExtensionsPanel'
import ExtPanelHost from './panels/ExtPanelHost'
import { useApp } from '../store'

export default function Sidebar(): React.JSX.Element {
  const inSession = useApp((s) => s.collab.active && !s.collab.joining)
  // Discussion fermée en fin de session : retour aux fichiers
  const current = useApp((s) => s.panel)
  const extPanel = useApp((s) => s.extUi.panels.find((p) => p.key === s.panel))
  // Panneau d'une extension arrêtée depuis : retour aux fichiers
  const panel = (current === 'chat' && !inSession) || (current.startsWith('ext:') && !extPanel) ? 'files' : current
  return (
    <div className="sidebar-inner">
      {panel === 'files' && <FileTree />}
      {panel === 'outline' && <OutlinePanel />}
      {panel === 'symbols' && <SymbolsPanel />}
      {panel === 'search' && <SearchPanel />}
      {panel === 'chat' && <ChatPanel />}
      {panel === 'extensions' && <ExtensionsPanel />}
      {extPanel && panel === extPanel.key && <ExtPanelHost panel={extPanel} />}
      <Copilot />
    </div>
  )
}
