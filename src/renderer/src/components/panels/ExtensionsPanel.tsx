import { Code2, FolderOpen, Link2, RotateCw, Settings2, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ExtensionInfo } from '../../../../shared/types'
import { compareVersions } from '../../lib/changelog'
import { ask } from '../../lib/dialog'
import { applyColorTheme, loadExtensions } from '../../lib/extensions'
import { reloadWindow, restartExtension } from '../../lib/extHost'
import { store, toast, updateSettings, useApp } from '../../store'
import { cleanError } from '../Copilot'

const hasCode = (e: ExtensionInfo): boolean => !!(e.main || e.node)

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
    n(e.themes.length, 'thème de couleurs', 'thèmes de couleurs'),
    e.languages.length ? `langage ${e.languages.map((l) => l.name).join(', ')}` : null
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Ce que l'extension pourra faire, en clair (fenêtre d'installation) */
function permissionLines(e: ExtensionInfo): string[] {
  const out: string[] = []
  if (hasCode(e)) out.push('lire et modifier les fichiers du projet ouvert')
  if (e.permissions.network.length) out.push(`se connecter à ${e.permissions.network.join(', ')}`)
  if (e.permissions.microphone) out.push('utiliser votre micro')
  if (e.permissions.camera) out.push('utiliser votre caméra')
  if (e.permissions.session) out.push('échanger des données avec les autres participants d’une session partagée')
  if (e.node) out.push('lancer des programmes de votre ordinateur (partie Node.js)')
  return out
}

/** Résumé des permissions sur une carte */
function permissionSummary(e: ExtensionInfo): string {
  if (!hasCode(e)) return ''
  return [
    'Fichiers du projet',
    e.permissions.network.length ? `Internet : ${e.permissions.network.join(', ')}` : '',
    e.permissions.microphone ? 'Micro' : '',
    e.permissions.camera ? 'Caméra' : '',
    e.permissions.session ? 'Sessions' : '',
    e.node ? 'Programmes' : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Extension avec code : l'utilisateur voit ce qu'elle pourra faire avant de l'installer */
async function confirmInstall(e: ExtensionInfo, verified: boolean, old?: ExtensionInfo): Promise<boolean> {
  if (!hasCode(e)) return true
  // Mise à jour sans nouvelle permission : rien à redemander
  if (old && JSON.stringify(permissionLines(old)) === JSON.stringify(permissionLines(e))) return true
  const dev = store.get().settings.extDevMode
  const intro = verified
    ? 'Elle a été relue avant d’entrer dans le catalogue.'
    : dev
      ? 'Cette extension n’a pas été relue. En mode développeur, elle fonctionnera comme une extension vérifiée, avec tous les pouvoirs : installez-la seulement si vous connaissez son auteur.'
      : `Cette extension n’a pas été relue. Installez-la seulement si vous faites confiance à son auteur${e.author ? ` (${e.author})` : ''}. Elle sera désactivée pendant les sessions partagées.`
  const lines = permissionLines(e)
  const a = await ask({
    title: old ? `Mettre à jour « ${e.name} » ?` : `Installer « ${e.name} » ?`,
    message: intro,
    detail: lines.length ? `Elle pourra :\n${lines.map((l) => `• ${l}`).join('\n')}` : undefined,
    buttons: ['Annuler', old ? 'Mettre à jour' : 'Installer']
  })
  return a.button === 1
}

function TrustBadge({ e }: { e: ExtensionInfo }): React.JSX.Element | null {
  if (e.linked) return <span className="ext-badge dev" title={e.linked}><Link2 size={11} /> Reliée</span>
  if (e.trust === 'verified') return <span className="ext-badge ok"><ShieldCheck size={11} /> Vérifiée</span>
  if (e.trust === 'modified')
    return (
      <span className="ext-badge warn" title="Ses fichiers ont changé depuis son installation : réinstallez-la depuis le catalogue">
        <ShieldAlert size={11} /> Modifiée
      </span>
    )
  return <span className="ext-badge warn"><ShieldAlert size={11} /> Non vérifiée</span>
}

function Switch({ value, onChange, title }: { value: boolean; onChange: (v: boolean) => void; title?: string }): React.JSX.Element {
  return (
    <button className={`switch${value ? ' on' : ''}`} role="switch" aria-checked={value} title={title} onClick={() => onChange(!value)}>
      <span />
    </button>
  )
}

/** Réglages déclarés par l'extension (formulaire dessiné par Lumen TeX) et accès au micro et à la caméra */
function ExtensionSettings({ e }: { e: ExtensionInfo }): React.JSX.Element {
  const values = useApp((s) => s.settings.extSettings?.[e.id]) ?? {}
  const media = useApp((s) => s.settings.extMedia?.[e.id])
  const set = (id: string, v: unknown): void => {
    const all = store.get().settings.extSettings ?? {}
    void updateSettings({ extSettings: { ...all, [e.id]: { ...(all[e.id] ?? {}), [id]: v } } })
  }
  return (
    <div className="ext-settings">
      {e.settings.map((s) => {
        const v = values[s.id] ?? s.default
        return (
          <label key={s.id} className="ext-setting">
            <span>
              {s.label}
              {s.description && <small>{s.description}</small>}
            </span>
            {s.type === 'toggle' ? (
              <Switch value={!!v} onChange={(x) => set(s.id, x)} />
            ) : s.type === 'select' ? (
              <select className="input small" value={String(v)} onChange={(ev) => set(s.id, ev.target.value)}>
                {s.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                className="input small"
                type={s.type === 'number' ? 'number' : 'text'}
                value={String(v)}
                onChange={(ev) => set(s.id, s.type === 'number' ? Number(ev.target.value) : ev.target.value)}
              />
            )}
          </label>
        )
      })}
      {media !== undefined && (
        <div className="ext-setting">
          <span>Micro et caméra : {media ? 'autorisés' : 'refusés'}</span>
          <button
            className="btn small"
            onClick={() => {
              const { [e.id]: _, ...rest } = store.get().settings.extMedia ?? {}
              void updateSettings({ extMedia: rest })
            }}
          >
            Redemander
          </button>
        </div>
      )}
    </div>
  )
}

function ExtensionCard({ e, children, installed }: { e: ExtensionInfo; children: React.ReactNode; installed?: boolean }): React.JSX.Element {
  const disabled = useApp((s) => s.settings.extDisabled?.includes(e.id))
  const media = useApp((s) => s.settings.extMedia?.[e.id])
  const [open, setOpen] = useState(false)
  const toggle = async (on: boolean): Promise<void> => {
    const off = store.get().settings.extDisabled ?? []
    await updateSettings({ extDisabled: on ? off.filter((x) => x !== e.id) : [...off, e.id] })
    applyColorTheme(store.get().settings.colorTheme)
    await restartExtension(e.id)
  }
  const perms = permissionSummary(e)
  return (
    <div className={`ext-card${installed && disabled ? ' off' : ''}`}>
      <div className="ext-main">
        <div className="ext-title">
          <strong>{e.name}</strong> <span>{e.version}</span>
          {e.author && <span>{' · '}{e.author}</span>}
        </div>
        <div className="ext-badges">
          <TrustBadge e={e} />
          {hasCode(e) && (
            <span className="ext-badge">
              <Code2 size={11} /> Code
            </span>
          )}
        </div>
        {e.description && <div className="ext-desc">{e.description}</div>}
        <div className="ext-contents">{e.compatible ? contents(e) : `Nécessite Lumen TeX ${e.lumen} ou plus récent`}</div>
        {perms && <div className="ext-contents">{perms}</div>}
      </div>
      <div className="ext-actions">
        {installed && e.compatible && <Switch value={!disabled} onChange={(v) => void toggle(v)} title={disabled ? 'Activer' : 'Désactiver'} />}
        {installed && (e.settings.length > 0 || media !== undefined) && (
          <button className={`btn small${open ? ' active' : ''}`} onClick={() => setOpen(!open)} title="Réglages de l’extension">
            <Settings2 size={13} />
          </button>
        )}
        {children}
      </div>
      {open && <ExtensionSettings e={e} />}
    </div>
  )
}

/** Mode développeur : extensions non vérifiées traitées comme vérifiées, dossier relié, rechargement, outils */
function DeveloperMode(): React.JSX.Element {
  const dev = useApp((s) => s.settings.extDevMode)
  const toggle = async (on: boolean): Promise<void> => {
    if (on) {
      const a = await ask({
        title: 'Mode développeur',
        message: 'Toutes vos extensions fonctionneront comme si elles étaient vérifiées, y compris pendant les sessions partagées.',
        detail:
          'Une extension non vérifiée pourra alors accéder à tout votre ordinateur. Activez ce mode seulement pour développer ou tester une extension dont vous connaissez l’auteur. Les autres participants d’une session en seront prévenus.',
        buttons: ['Annuler', 'Activer']
      })
      if (a.button !== 1) return
    }
    await updateSettings({ extDevMode: on })
    // Extensions à recharger avec leur nouveau statut
    if (store.get().extensions.some((e) => hasCode(e) && e.trust !== 'verified')) await reloadWindow()
  }
  return (
    <>
      <div className="settings-subtitle ext-dev-title">
        <span>Mode développeur</span>
        <Switch value={dev} onChange={(v) => void toggle(v)} />
      </div>
      {dev && (
        <div className="ext-dev-actions">
          <button className="btn small" onClick={() => void reloadWindow()}>
            <RotateCw size={13} /> Recharger les extensions
          </button>
          <button className="btn small" onClick={() => void window.api.extDevtools()}>
            <Wrench size={13} /> Outils de développement
          </button>
        </div>
      )}
    </>
  )
}

/** Extensions installées, catalogue officiel (dépôt GitHub LumenTEX-extensions), installation depuis un dossier */
export function ExtensionsList(): React.JSX.Element {
  const installed = useApp((st) => st.extensions)
  const colorTheme = useApp((st) => st.settings.colorTheme)
  const dev = useApp((st) => st.settings.extDevMode)
  const [catalog, setCatalog] = useState<ExtensionInfo[] | null | undefined>(undefined)
  const [busy, setBusy] = useState('')

  const fetchCatalog = (): void => {
    setCatalog(undefined)
    void window.api.extCatalog().then(setCatalog)
  }
  useEffect(fetchCatalog, [])

  /** action : identifiant de l'extension et message de réussite, ou null (annulée) */
  const run = async (key: string, action: () => Promise<{ id: string; done: string } | null>): Promise<void> => {
    setBusy(key)
    try {
      const r = await action()
      await loadExtensions()
      applyColorTheme(store.get().settings.colorTheme)
      if (r) {
        toast(r.done, 'success')
        await restartExtension(r.id)
      }
    } catch (e) {
      toast(cleanError(e), 'error', undefined, 6000)
    }
    setBusy('')
  }
  const install = (e: ExtensionInfo, old?: ExtensionInfo): Promise<void> =>
    run(e.id, async () => {
      if (!(await confirmInstall(e, true, old))) return null
      await window.api.extInstall(e.id)
      return { id: e.id, done: old ? `L’extension « ${e.name} » est à jour (${e.version})` : `L’extension « ${e.name} » est installée` }
    })
  const uninstall = (e: ExtensionInfo): Promise<void> =>
    run(e.id, async () => {
      await window.api.extUninstall(e.id)
      if (colorTheme.startsWith(e.id + '/')) await updateSettings({ colorTheme: '' })
      return { id: e.id, done: `L’extension « ${e.name} » est désinstallée` }
    })
  const fromFolder = (link: boolean): Promise<void> =>
    run('folder', async () => {
      const picked = await window.api.extPickFolder()
      if (!picked) return null
      const old = installed.find((i) => i.id === picked.ext.id)
      if (!(await confirmInstall(picked.ext, false, old))) return null
      const e = await window.api.extInstallPath(picked.folder, link)
      return { id: e.id, done: link ? `L’extension « ${e.name} » est reliée à son dossier` : `L’extension « ${e.name} » est installée` }
    })

  const available = catalog?.filter((c) => !installed.some((i) => i.id === c.id)) ?? []
  const newer = (e: ExtensionInfo): ExtensionInfo | undefined => catalog?.find((c) => c.id === e.id && compareVersions(c.version, e.version) > 0)
  /** Version vérifiée du catalogue pour une extension installée depuis un dossier (ou modifiée) */
  const verifiedCopy = (e: ExtensionInfo): ExtensionInfo | undefined => (e.trust !== 'verified' ? catalog?.find((c) => c.id === e.id) : undefined)

  return (
    <>
      <div className="settings-subtitle">Installées</div>
      {installed.length ? (
        installed.map((e) => {
          const update = newer(e) ?? verifiedCopy(e)
          return (
            <ExtensionCard key={e.id} e={e} installed>
              {update && (
                <button className="btn small primary" disabled={!!busy || !update.compatible} onClick={() => void install(update, e)}>
                  {compareVersions(update.version, e.version) > 0 ? `Mettre à jour (${update.version})` : 'Version vérifiée'}
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
      <div className="ext-folder">
        <button className="btn small" disabled={!!busy} onClick={() => void fromFolder(false)}>
          <FolderOpen size={13} /> Installer depuis un dossier…
        </button>
        {dev && (
          <button className="btn small" disabled={!!busy} onClick={() => void fromFolder(true)} title="Sans copie : les modifications du dossier sont prises au rechargement">
            <Link2 size={13} /> Relier un dossier…
          </button>
        )}
      </div>

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
      <DeveloperMode />
      <div className="settings-note">
        Les extensions ajoutent des bouts de LaTeX, des symboles, des modèles, des thèmes, des compilateurs et d’autres langages, ou de
        nouvelles fonctions. Celles du catalogue sont relues avant d’y entrer ; celles installées depuis un dossier ne le sont pas, et
        fonctionnent isolées. Pour en créer une ou proposer la vôtre, voyez{' '}
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
