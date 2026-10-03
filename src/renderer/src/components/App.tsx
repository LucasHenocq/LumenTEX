import { useEffect } from 'react'
import { applySettingsToEditor, handleFsChanged, openPath, openProject, saveAll } from '../lib/actions'
import { runCommand } from '../lib/commands'
import { store, toast, useApp } from '../store'
import Modals from './Modals'
import Toasts from './Toasts'
import Welcome from './Welcome'
import Workspace from './Workspace'
import { checkWhatsNew } from '../lib/changelog'

const api = window.api

function applyTheme(): void {
  const { settings } = store.get()
  const dark =
    settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const root = document.documentElement.style
  root.setProperty('--editor-font-size', `${settings.editorFontSize}px`)
  root.setProperty('--editor-font', settings.editorFontFamily)
  store.set({ resolvedDark: dark })
}

export default function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const root = useApp((s) => s.root)
  const settings = useApp((s) => s.settings)

  useEffect(() => {
    const offs = [
      api.onMenu((id) => runCommand(id)),
      api.onOpenPath((p) => void openPath(p)),
      api.onUpdateReady((version) =>
        toast(`Lumen TeX ${version} est prêt à être installé`, 'success', { label: 'Redémarrer', run: () => void saveAll().then(() => api.installUpdate()) }, 120000)
      ),
      api.onFsChanged((paths) => void handleFsChanged(paths)),
      api.onCompileProgress((line) =>
        store.set({
          compileProgress: line
            .replace(/^downloading (.*)$/, 'Téléchargement de $1…')
            .replace(/^Running (.*?) \.\.\.$/, 'Exécution de $1…')
            .replace(/^Rerunning TeX because .*$/, 'Nouvelle passe de TeX (références)…')
            .replace(/^generating format .*$/, 'Préparation du format LaTeX (première fois)…')
        })
      ),
      api.onSaveBeforeClose(() => {
        void saveAll().then(() => api.closeNow())
      })
    ]
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onMedia = (): void => applyTheme()
    media.addEventListener('change', onMedia)

    void (async () => {
      const [settings, tectonic] = await Promise.all([api.getSettings(), api.tectonicStatus()])
      store.set({ settings, tectonic })
      applyTheme()
      store.set({ ready: true })
      checkWhatsNew()
      const pending = await api.pendingOpen()
      if (pending) await openPath(pending)
      else if (settings.lastProject) {
        const st = await api.stat(settings.lastProject)
        if (st.exists) await openProject(settings.lastProject)
      }
    })()

    return () => {
      offs.forEach((off) => off())
      media.removeEventListener('change', onMedia)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    applyTheme()
    applySettingsToEditor()
  }, [settings, ready])

  if (!ready) return <div className="app-loading" />

  return (
    <>
      {root ? <Workspace /> : <Welcome />}
      <Modals />
      <Toasts />
    </>
  )
}
