import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ExtensionInfo } from '../../../../shared/types'
import { compareVersions } from '../../lib/changelog'
import { applyColorTheme, loadExtensions } from '../../lib/extensions'
import { store, toast, updateSettings, useApp } from '../../store'
import { cleanError } from '../Copilot'

/** Ce qu'apporte une extension, en quelques mots */
function contents(e: ExtensionInfo): string {
  const n = (count: number, one: string, many: string): string | null => (count ? `${count} ${count > 1 ? many : one}` : null)
  return [
    n(e.snippets.length, 'bout de LaTeX', 'bouts de LaTeX'),
    n(e.environments.length, 'environnement', 'environnements'),
    n(
      e.symbols.reduce((k, g) => k + g.items.length, 0),
      'symbole',
      'symboles'
    ),
    n(e.templates.length, 'modèle de projet', 'modèles de projet'),
    n(e.themes.length, 'thème de couleurs', 'thèmes de couleurs')
  ]
    .filter(Boolean)
    .join(' · ')
}

function ExtensionCard({ e, children }: { e: ExtensionInfo; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="ext-card">
      <div className="ext-main">
        <div className="ext-title">
          <strong>{e.name}</strong> <span>{e.version}</span>
          {e.author && <span>{' · '}{e.author}</span>}
        </div>
        {e.description && <div className="ext-desc">{e.description}</div>}
        <div className="ext-contents">{e.compatible ? contents(e) : `Nécessite Lumen TeX ${e.lumen} ou plus récent`}</div>
      </div>
      <div className="ext-actions">{children}</div>
    </div>
  )
}

/** Extensions installées, catalogue officiel (dépôt GitHub LumenTEX-extensions), installation depuis un dossier */
export function ExtensionsList(): React.JSX.Element {
  const installed = useApp((st) => st.extensions)
  const colorTheme = useApp((st) => st.settings.colorTheme)
  const [catalog, setCatalog] = useState<ExtensionInfo[] | null | undefined>(undefined)
  const [busy, setBusy] = useState('')

  const fetchCatalog = (): void => {
    setCatalog(undefined)
    void window.api.extCatalog().then(setCatalog)
  }
  useEffect(fetchCatalog, [])

  /** action : message de réussite, ou null (annulée) */
  const run = async (id: string, action: () => Promise<string | null>): Promise<void> => {
    setBusy(id)
    try {
      const done = await action()
      await loadExtensions()
      applyColorTheme(store.get().settings.colorTheme)
      if (done) toast(done, 'success')
    } catch (e) {
      toast(cleanError(e), 'error', undefined, 6000)
    }
    setBusy('')
  }
  const install = (e: ExtensionInfo, update = false): Promise<void> =>
    run(e.id, async () => {
      await window.api.extInstall(e.id)
      return update ? `L’extension « ${e.name} » est à jour (${e.version})` : `L’extension « ${e.name} » est installée`
    })
  const uninstall = (e: ExtensionInfo): Promise<void> =>
    run(e.id, async () => {
      await window.api.extUninstall(e.id)
      if (colorTheme.startsWith(e.id + '/')) await updateSettings({ colorTheme: '' })
      return `L’extension « ${e.name} » est désinstallée`
    })
  const fromFolder = (): Promise<void> =>
    run('folder', async () => {
      const e = await window.api.extInstallFolder()
      return e && `L’extension « ${e.name} » est installée`
    })

  const available = catalog?.filter((c) => !installed.some((i) => i.id === c.id)) ?? []
  const newer = (e: ExtensionInfo): ExtensionInfo | undefined => catalog?.find((c) => c.id === e.id && compareVersions(c.version, e.version) > 0)

  return (
    <>
      <div className="settings-subtitle">Installées</div>
      {installed.length ? (
        installed.map((e) => {
          const update = newer(e)
          return (
            <ExtensionCard key={e.id} e={e}>
              {update && (
                <button className="btn small primary" disabled={!!busy || !update.compatible} onClick={() => void install(update, true)}>
                  Mettre à jour ({update.version})
                </button>
              )}
              <button className="btn small" disabled={!!busy} onClick={() => void uninstall(e)}>
                Désinstaller
              </button>
            </ExtensionCard>
          )
        })
      ) : (
        <div className="ext-empty">Aucune extension installée.</div>
      )}
      <button className="btn small ext-folder" disabled={!!busy} onClick={() => void fromFolder()}>
        <FolderOpen size={13} /> Installer depuis un dossier…
      </button>

      <div className="settings-subtitle">Catalogue</div>
      {catalog === undefined ? (
        <div className="ext-empty">Chargement du catalogue…</div>
      ) : catalog === null ? (
        <div className="ext-empty">
          Impossible de joindre le catalogue. Vérifiez votre connexion à Internet.{' '}
          <button className="btn small" onClick={fetchCatalog}>
            Réessayer
          </button>
        </div>
      ) : available.length ? (
        available.map((e) => (
          <ExtensionCard key={e.id} e={e}>
            <button className="btn small primary" disabled={!!busy || !e.compatible} onClick={() => void install(e)}>
              {busy === e.id ? 'Installation…' : 'Installer'}
            </button>
          </ExtensionCard>
        ))
      ) : (
        <div className="ext-empty">{catalog.length ? 'Toutes les extensions du catalogue sont installées.' : 'Aucune extension dans le catalogue pour le moment.'}</div>
      )}
      <div className="settings-note">
        Les extensions ajoutent des bouts de LaTeX à l’autocomplétion, des environnements, des symboles au panneau Σ, des modèles de
        projet et des thèmes de couleurs. Elles ne contiennent pas de code. Pour en créer une ou proposer la vôtre au catalogue, voyez{' '}
        <a href="https://github.com/LucasHenocq/LumenTEX-extensions" target="_blank" rel="noreferrer">
          LumenTEX-extensions
        </a>{' '}
        sur GitHub.
      </div>
    </>
  )
}

/** Onglet Extensions de la barre latérale */
export default function ExtensionsPanel(): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Extensions</span>
      </div>
      <div className="panel-body ext-panel">
        <ExtensionsList />
      </div>
    </div>
  )
}
