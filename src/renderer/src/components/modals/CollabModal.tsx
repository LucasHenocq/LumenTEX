import { Copy, FolderOpen, LogOut, Users, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatCode, joinSession, shareProject, stopSession } from '../../lib/collab'
import { store, toast, updateSettings, useApp, type CollabState } from '../../store'
import { closeModal, ModalFrame } from '../Modals'

/**
 * État du réseau en mots simples (jamais d'erreur technique : les détails vont dans collab.log).
 * tone : ok (vert), wait (neutre), warn (orange)
 */
export function collabMessage(c: CollabState, waitedLong = false): { tone: 'ok' | 'wait' | 'warn'; title: string; text?: string } {
  const { state, peers } = c.net
  if (state === 'unavailable')
    return {
      tone: 'warn',
      title: 'Le partage n’est pas disponible sur cet ordinateur',
      text: 'Le module réseau de Lumen TeX n’a pas pu démarrer. L’édition seule fonctionne normalement ; réinstaller Lumen TeX règle généralement le problème.'
    }
  if (state === 'network')
    return {
      tone: 'warn',
      title: 'Le réseau de partage ne répond pas',
      text:
        'Vérifie ta connexion Internet. Certains réseaux (école, entreprise) bloquent les connexions directes entre ordinateurs : essaie un autre réseau, par exemple un partage de connexion. Lumen TeX continue d’essayer' +
        (c.joining ? '.' : ' ; tes modifications seront fusionnées au retour.')
    }
  if (state === 'starting' || state === 'searching') return { tone: 'wait', title: 'Connexion au réseau de partage…' }
  if (peers > 0) {
    if (c.joining) return { tone: 'wait', title: 'Réception du projet…' }
    return { tone: 'ok', title: peers === 1 ? '1 personne connectée' : `${peers} personnes connectées` }
  }
  if (c.joining)
    return waitedLong
      ? {
          tone: 'warn',
          title: 'Personne de la session n’est connecté pour l’instant',
          text: 'Au moins une personne de la session doit avoir Lumen TeX ouvert sur ce projet. Vérifie aussi le code. Lumen TeX continue d’attendre.'
        }
      : { tone: 'wait', title: 'Recherche des participants…' }
  return { tone: 'wait', title: 'En attente de participants', text: 'Envoie le code à tes amis : ils le saisissent dans « Rejoindre une session ».' }
}

function Banner({ c, waitedLong }: { c: CollabState; waitedLong?: boolean }): React.JSX.Element {
  const m = collabMessage(c, waitedLong)
  return (
    <div className={`collab-banner ${m.tone}`}>
      {m.tone === 'warn' ? <WifiOff size={16} /> : <span className={`collab-dot ${m.tone}`} />}
      <div>
        <strong>{m.title}</strong>
        {m.text && <p>{m.text}</p>}
      </div>
    </div>
  )
}

function NameField(): React.JSX.Element {
  const name = useApp((s) => s.settings.collabName)
  const [fallback, setFallback] = useState('')
  useEffect(() => void window.api.userName().then(setFallback), [])
  return (
    <label className="collab-field">
      <span>Ton nom (visible par les autres)</span>
      <input className="input" value={name} placeholder={fallback} maxLength={40} onChange={(e) => void updateSettings({ collabName: e.target.value })} />
    </label>
  )
}

function JoinForm({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const [code, setCode] = useState('')
  const [dir, setDir] = useState('')
  const [invalid, setInvalid] = useState(false)
  useEffect(() => void window.api.paths().then((p) => setDir(`${p.documents.replace(/\\/g, '/')}/Lumen TeX partagés`)), [])
  const join = async (): Promise<void> => {
    if (!(await joinSession(code, dir))) setInvalid(true)
  }
  return (
    <form
      className="collab-body"
      onSubmit={(e) => {
        e.preventDefault()
        void join()
      }}
    >
      <p className="collab-intro">Saisis le code reçu : tu recevras une copie du projet et vous éditerez en même temps.</p>
      <label className="collab-field">
        <span>Code de la session</span>
        <input
          className={`input collab-code-input${invalid ? ' invalid' : ''}`}
          value={code}
          autoFocus
          placeholder="XXXX-XXXX-XXXX-XXXX"
          spellCheck={false}
          onChange={(e) => {
            setInvalid(false)
            setCode(e.target.value.toUpperCase())
          }}
        />
        {invalid && <small className="collab-error">Ce code n’est pas valide : il compte 16 caractères (lettres et chiffres).</small>}
      </label>
      <NameField />
      <label className="collab-field">
        <span>Le projet sera enregistré dans</span>
        <div className="input-row">
          <input className="input" value={dir} onChange={(e) => setDir(e.target.value)} />
          <button
            type="button"
            className="btn"
            title="Choisir un dossier"
            onClick={async () => {
              const d = await window.api.chooseDir(dir || undefined)
              if (d) setDir(d.replace(/\\/g, '/'))
            }}
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </label>
      <div className="collab-actions">
        {onBack && (
          <button type="button" className="btn ghost" onClick={onBack}>
            Retour
          </button>
        )}
        <button type="submit" className="btn primary" disabled={code.replace(/[^0-9A-Z]/gi, '').length < 16 || !dir.trim()}>
          Rejoindre
        </button>
      </div>
    </form>
  )
}

function Joining({ c }: { c: CollabState }): React.JSX.Element {
  const [waitedLong, setWaitedLong] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setWaitedLong(true), 20000)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className="collab-body">
      <Banner c={c} waitedLong={waitedLong} />
      <p className="collab-muted">Session {formatCode(c.code)}</p>
      <div className="collab-actions">
        <button className="btn" onClick={() => void stopSession({ forget: false })}>
          Annuler
        </button>
      </div>
    </div>
  )
}

function InSession({ c }: { c: CollabState }): React.JSX.Element {
  const settingsName = useApp((s) => s.settings.collabName)
  const copy = (): void => {
    void navigator.clipboard.writeText(formatCode(c.code))
    toast('Code copié', 'success')
  }
  const leave = async (): Promise<void> => {
    const ok = await window.api.confirm(
      'Quitter la session partagée ?',
      'Tes fichiers restent sur ton ordinateur, mais ne seront plus synchronisés. Pour revenir, il faudra de nouveau le code.',
      'Quitter la session'
    )
    if (!ok) return
    await stopSession({ forget: true })
    closeModal()
  }
  return (
    <div className="collab-body">
      <Banner c={c} />
      <div className="collab-code-box">
        <span className="collab-code">{formatCode(c.code)}</span>
        <button className="btn" onClick={copy}>
          <Copy size={14} /> Copier
        </button>
      </div>
      <p className="collab-muted">
        Envoie ce code à tes amis : il donne accès au projet, ne le partage qu’avec eux. Les ordinateurs se connectent directement,
        sans serveur.
      </p>
      <div className="collab-people">
        <div className="collab-person">
          <span className="collab-dot ok" /> {settingsName || 'Toi'} <small>(toi)</small>
        </div>
        {c.people.map((p) => (
          <div key={p.id} className="collab-person">
            <span className="collab-dot" style={{ background: p.color }} /> {p.name}
            {p.file && <small>{p.file}</small>}
          </div>
        ))}
      </div>
      <div className="collab-actions">
        <button className="btn ghost" onClick={() => void leave()}>
          <LogOut size={14} /> Quitter la session
        </button>
      </div>
    </div>
  )
}

export default function CollabModal({ join }: { join?: boolean }): React.JSX.Element {
  const c = useApp((s) => s.collab)
  const root = useApp((s) => s.root)
  const projectName = useApp((s) => s.projectName)
  const [mode, setMode] = useState<'share' | 'join'>(join || !root ? 'join' : 'share')
  const [busy, setBusy] = useState(false)

  let body: React.JSX.Element
  if (c.active && c.joining) body = <Joining c={c} />
  else if (c.active) body = <InSession c={c} />
  else if (mode === 'join') body = <JoinForm onBack={root ? () => setMode('share') : undefined} />
  else
    body = (
      <div className="collab-body">
        <p className="collab-intro">
          Travaille sur « {projectName} » avec tes amis, en direct : chacun voit le texte et le curseur des autres, et compile le PDF chez
          lui. Les ordinateurs se connectent directement, sans serveur ni compte.
        </p>
        <NameField />
        <div className="collab-actions">
          <button className="btn ghost" onClick={() => setMode('join')}>
            Rejoindre une autre session
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await shareProject()
              setBusy(false)
            }}
          >
            <Users size={14} /> {busy ? 'Préparation…' : 'Partager ce projet'}
          </button>
        </div>
      </div>
    )

  return (
    <ModalFrame title={c.active && !c.joining ? 'Session partagée' : mode === 'join' || c.joining ? 'Rejoindre une session' : 'Travailler à plusieurs'} width={520} className="collab-modal">
      {body}
    </ModalFrame>
  )
}

/** Ouvre la fenêtre de partage */
export const openCollab = (join?: boolean): void => store.set({ modal: { type: 'collab', join } })
