import FileTree from './panels/FileTree'
import OutlinePanel from './panels/OutlinePanel'
import SearchPanel from './panels/SearchPanel'
import SymbolsPanel from './panels/SymbolsPanel'
import Copilot from './Copilot'
import { useApp } from '../store'

export default function Sidebar(): React.JSX.Element {
  const panel = useApp((s) => s.panel)
  return (
    <div className="sidebar-inner">
      {panel === 'files' && <FileTree />}
      {panel === 'outline' && <OutlinePanel />}
      {panel === 'symbols' && <SymbolsPanel />}
      {panel === 'search' && <SearchPanel />}
      <Copilot />
    </div>
  )
}
