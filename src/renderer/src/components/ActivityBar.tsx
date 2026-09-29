import { Files, ListTree, Search, Sigma, Command, CircleHelp } from 'lucide-react'
import type { SidebarPanel } from '../store'
import { store, updateSettings, useApp } from '../store'
import { kb } from '../lib/keys'

const ITEMS: { id: SidebarPanel; icon: typeof Files; label: string }[] = [
  { id: 'files', icon: Files, label: 'Fichiers (⌘1)' },
  { id: 'outline', icon: ListTree, label: 'Plan du document (⌘2)' },
  { id: 'symbols', icon: Sigma, label: 'Symboles (⌘3)' },
  { id: 'search', icon: Search, label: 'Rechercher (⌘4)' }
]

export default function ActivityBar(): React.JSX.Element {
  const panel = useApp((s) => s.panel)
  const visible = useApp((s) => s.settings.sidebarVisible)
  const errors = useApp((s) => s.diagnostics.filter((d) => d.severity === 'error').length)

  const select = (id: SidebarPanel): void => {
    if (panel === id && visible) void updateSettings({ sidebarVisible: false })
    else {
      store.set({ panel: id })
      if (!visible) void updateSettings({ sidebarVisible: true })
    }
  }

  return (
    <nav className="activitybar">
      {ITEMS.map(({ id, icon: Icon, label }) => (
        <button key={id} className={`ab-item${panel === id && visible ? ' active' : ''}`} title={kb(label)} onClick={() => select(id)}>
          <Icon size={20} strokeWidth={1.7} />
          {id === 'files' && errors > 0 && <span className="ab-badge">{errors}</span>}
        </button>
      ))}
      <div className="ab-spacer" />
      <button className="ab-item" title={kb('Palette de commandes (⇧⌘P)')} onClick={() => store.set({ modal: { type: 'palette', mode: 'commands' } })}>
        <Command size={19} strokeWidth={1.7} />
      </button>
      <button className="ab-item" title="Raccourcis clavier" onClick={() => store.set({ modal: { type: 'shortcuts' } })}>
        <CircleHelp size={19} strokeWidth={1.7} />
      </button>
    </nav>
  )
}
