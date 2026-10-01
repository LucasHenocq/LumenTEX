import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiEngine, AiStatus, Settings } from '../../../../shared/types'
import { emit } from '../../lib/bus'
import { store, toast, updateSettings, useApp } from '../../store'
import { ENGINES } from '../Copilot'
import TectonicSetup from '../TectonicSetup'
import { closeModal, ModalFrame } from '../Modals'
import { kb } from '../../lib/keys'

type Section = 'appearance' | 'editor' | 'compile' | 'pdf' | 'ai'

function statusText(engine: AiEngine, s: AiStatus | undefined): string {
  if (!s) return 'Vérification…'
  if (!s.installed) return 'Non installé'
  if (engine === 'ollama') return !s.running ? 'Installé, non lancé' : s.models?.length ? `Prêt · ${s.models.length} modèle(s) : ${s.models.slice(0, 3).join(', ')}${s.models.length > 3 ? '…' : ''}` : 'Aucun modèle téléchargé'
  if (!s.loggedIn) return engine === 'gemini' ? 'Clé d’API manquante' : 'Non connecté'
  return `Connecté${s.account ? ` · ${s.account}` : ''}`
}

/** État de chaque moteur ; la connexion elle-même se fait dans le panneau du copilot (écran de connexion) */
function AiAccounts(): React.JSX.Element {
  const current = useApp((st) => st.settings.aiEngine)
  const [statuses, setStatuses] = useState<Partial<Record<AiEngine, AiStatus>>>({})
  useEffect(() => {
    for (const e of Object.keys(ENGINES) as AiEngine[]) void window.api.aiStatus(e).then((s) => setStatuses((x) => ({ ...x, [e]: s })))
  }, [])
  const use = (e: AiEngine): void => {
    void updateSettings({ aiEngine: e })
    closeModal()
    emit('copilot:show', undefined)
  }
  return (
    <>
      {(Object.keys(ENGINES) as AiEngine[]).map((e) => {
        const s = statuses[e]
        const ready = !!s?.installed && s.loggedIn
        return (
          <Row key={e} label={ENGINES[e].name} hint={statusText(e, s)}>
            <div className="input-row">
              <span className={`dot${ready ? ' ok' : s ? ' off' : ''}`} />
              {e === 'ollama' && s && !s.installed ? (
                <button className="btn" onClick={() => void window.api.openExternal('https://ollama.com/download')}>
                  Télécharger Ollama
                </button>
              ) : (
                <button className="btn" disabled={ready && e === current} onClick={() => use(e)}>
                  {!ready ? 'Configurer…' : e === current ? 'Utilisé' : 'Utiliser'}
                </button>
              )}
            </div>
          </Row>
        )
      })}
    </>
  )
}

function DocsIndex(): React.JSX.Element {
  const [status, setStatus] = useState<{ chunks: number; dir: string } | null>(null)
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.api.docsStatus().then(setStatus)
    return window.api.onDocsProgress(setProgress)
  }, [])
  const build = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.buildDocs()
    } catch (e) {
      setProgress('⚠ ' + (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setBusy(false)
    setStatus(await window.api.docsStatus())
  }
  return (
    <Row
      label="Documentation pour Ollama"
      hint={`${status?.chunks ? `${status.chunks} passages indexés` : 'Non indexée'} — Wikibooks LaTeX (en, fr) + vos fichiers .txt/.md/.tex du dossier perso, cherchés à chaque question. Le modèle de recherche (embeddinggemma, ≈ 0,6 Go) est téléchargé si besoin.${progress ? ' ' + progress : ''}`}
    >
      <div className="input-row">
        <button className="btn" disabled={busy} onClick={() => void build()}>
          {busy ? 'Indexation…' : status?.chunks ? 'Réindexer' : 'Télécharger et indexer'}
        </button>
        <button className="btn" title="Ouvrir le dossier de documentation perso" onClick={() => void window.api.openDocsDir()}>
          <FolderOpen size={14} />
        </button>
      </div>
    </Row>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button className={`switch${value ? ' on' : ''}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span />
    </button>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export default function SettingsModal(): React.JSX.Element {
  const s = useApp((st) => st.settings)
  const tectonic = useApp((st) => st.tectonic)
  const [section, setSection] = useState<Section>('appearance')
  const set = (patch: Partial<Settings>): void => void updateSettings(patch)

  const recheck = async (): Promise<void> => {
    const status = await window.api.tectonicStatus(true)
    store.set({ tectonic: status })
    toast(status.found ? `Tectonic ${status.version} (${status.path})` : 'Tectonic introuvable', status.found ? 'success' : 'error')
  }

  return (
    <ModalFrame title="Réglages" width={720} className="settings-modal">
      <div className="settings">
        <nav className="settings-nav">
          {(
            [
              ['appearance', 'Apparence'],
              ['editor', 'Éditeur'],
              ['compile', 'Compilation'],
              ['pdf', 'Aperçu PDF'],
              ['ai', 'IA']
            ] as [Section, string][]
          ).map(([id, label]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
          <span className="settings-version">Lumen TeX {__APP_VERSION__}</span>
        </nav>
        <div className="settings-content">
          {section === 'appearance' && (
            <>
              <Row label="Thème">
                <div className="segmented">
                  {(
                    [
                      ['system', 'Système'],
                      ['light', 'Clair'],
                      ['dark', 'Sombre']
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} className={s.theme === v ? 'on' : ''} onClick={() => set({ theme: v })}>
                      {l}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="Taille du texte" hint={kb('Aussi avec ⌘= et ⌘−')}>
                <div className="number-control">
                  <button className="btn small" onClick={() => set({ editorFontSize: Math.max(9, s.editorFontSize - 1) })}>
                    −
                  </button>
                  <span>{s.editorFontSize} px</span>
                  <button className="btn small" onClick={() => set({ editorFontSize: Math.min(28, s.editorFontSize + 1) })}>
                    +
                  </button>
                </div>
              </Row>
              <Row label="Police de l’éditeur">
                <select className="input" value={s.editorFontFamily} onChange={(e) => set({ editorFontFamily: e.target.value })}>
                  <option value={'"SF Mono", "JetBrains Mono", Menlo, Monaco, monospace'}>SF Mono</option>
                  <option value={'Menlo, Monaco, monospace'}>Menlo</option>
                  <option value={'"JetBrains Mono", Menlo, monospace'}>JetBrains Mono</option>
                  <option value={'"Fira Code", Menlo, monospace'}>Fira Code</option>
                  <option value={'"IBM Plex Mono", Menlo, monospace'}>IBM Plex Mono</option>
                  <option value={'-apple-system, "SF Pro Text", sans-serif'}>SF Pro (proportionnelle)</option>
                  <option value={'"New York", Georgia, serif'}>New York (serif)</option>
                </select>
              </Row>
            </>
          )}
          {section === 'editor' && (
            <>
              <Row label="Retour à la ligne automatique">
                <Toggle value={s.lineWrapping} onChange={(v) => set({ lineWrapping: v })} />
              </Row>
              <Row label="Correcteur orthographique" hint="Clic droit sur un mot souligné pour les suggestions">
                <Toggle value={s.spellcheck} onChange={(v) => set({ spellcheck: v })} />
              </Row>
              <Row label="Aperçu des formules au survol" hint="Rendu KaTeX des maths sous la souris">
                <Toggle value={s.mathPreview} onChange={(v) => set({ mathPreview: v })} />
              </Row>
              <Row label="Mode Vim">
                <Toggle value={s.vimMode} onChange={(v) => set({ vimMode: v })} />
              </Row>
            </>
          )}
          {section === 'compile' && (
            <>
              <Row label="Compilation automatique (live)" hint="Recompile pendant la saisie et enregistre automatiquement">
                <Toggle value={s.autoCompile} onChange={(v) => set({ autoCompile: v })} />
              </Row>
              <Row label="Délai avant compilation" hint="Après la dernière frappe">
                <div className="range-control">
                  <input
                    type="range"
                    min={300}
                    max={5000}
                    step={100}
                    value={s.compileDelay}
                    onChange={(e) => set({ compileDelay: Number(e.target.value) })}
                  />
                  <span>{(s.compileDelay / 1000).toLocaleString('fr-FR')} s</span>
                </div>
              </Row>
              <Row label="Compiler à l’enregistrement" hint="Quand la compilation automatique est désactivée">
                <Toggle value={s.compileOnSave} onChange={(v) => set({ compileOnSave: v })} />
              </Row>
              <Row label="Autoriser shell-escape" hint="Nécessaire pour minted ; n’activez que pour des documents de confiance">
                <Toggle value={s.shellEscape} onChange={(v) => set({ shellEscape: v })} />
              </Row>
              <div className="settings-subtitle">Moteur Tectonic</div>
              {tectonic?.found ? (
                <div className="engine-info">
                  <span className="dot ok" /> Tectonic {tectonic.version} <span className="muted">— {tectonic.path}</span>
                </div>
              ) : (
                <TectonicSetup />
              )}
              <Row label="Chemin personnalisé" hint="Laisser vide pour la détection automatique">
                <div className="input-row">
                  <input
                    className="input"
                    placeholder="/opt/homebrew/bin/tectonic"
                    defaultValue={s.tectonicPath}
                    onBlur={(e) => {
                      set({ tectonicPath: e.target.value.trim() })
                      void recheck()
                    }}
                  />
                </div>
              </Row>
              <Row label="Dossier du cache des paquets" hint="Vide = ~/Library/Caches/Tectonic">
                <div className="input-row">
                  <input className="input" value={s.tectonicCacheDir} onChange={(e) => set({ tectonicCacheDir: e.target.value })} />
                  <button
                    className="btn"
                    onClick={async () => {
                      const d = await window.api.chooseDir(s.tectonicCacheDir || undefined)
                      if (d) set({ tectonicCacheDir: d })
                    }}
                  >
                    <FolderOpen size={14} />
                  </button>
                </div>
              </Row>
            </>
          )}
          {section === 'ai' && (
            <>
              <div className="settings-subtitle">Connexions</div>
              <AiAccounts />
              <div className="settings-subtitle">Ollama</div>
              <DocsIndex />
            </>
          )}
          {section === 'pdf' && (
            <>
              <Row label="Mode sombre du PDF" hint="Inverse les couleurs des pages">
                <Toggle value={s.pdfDarkMode} onChange={(v) => set({ pdfDarkMode: v })} />
              </Row>
              <Row label="Afficher l’aperçu">
                <Toggle value={s.pdfVisible} onChange={(v) => set({ pdfVisible: v })} />
              </Row>
              <div className="settings-note">
                Astuces : <kbd>{kb('⌘')}</kbd>+clic dans l’éditeur ou <kbd>{kb('⌥⌘J')}</kbd> pour localiser le texte dans le PDF ; double-clic dans le PDF pour
                revenir à la source. Pincez le trackpad ou <kbd>{kb('⌘')}</kbd>+molette pour zoomer.
              </div>
            </>
          )}
        </div>
      </div>
    </ModalFrame>
  )
}
