import { Sparkles } from 'lucide-react'
import { entriesSince } from '../../lib/changelog'
import { closeModal, ModalFrame } from '../Modals'

const formatDate = (iso: string): string => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Nouveautés depuis since (après une mise à jour), ou historique complet (since absent) */
export default function WhatsNewModal({ since }: { since?: string }): React.JSX.Element {
  const entries = entriesSince(since)
  const title = !since
    ? 'Historique des versions'
    : entries.length > 1
      ? `${entries.length} mises à jour installées`
      : `Nouveautés de Lumen TeX ${entries[0]?.version ?? __APP_VERSION__}`
  return (
    <ModalFrame
      title={title}
      width={540}
      className="whats-new-modal"
      footer={
        <button className="btn primary" onClick={closeModal}>
          {since ? 'C’est parti' : 'Fermer'}
        </button>
      }
    >
      <div className="whats-new">
        {since && (
          <p className="whats-new-intro">
            <Sparkles size={15} /> Lumen TeX vient d’être mis à jour en version {__APP_VERSION__}. Voici ce qui a changé :
          </p>
        )}
        {entries.map((e) => (
          <section key={e.version} className="whats-new-version">
            <header>
              <strong>Version {e.version}</strong>
              <span>{formatDate(e.date)}</span>
              {e.version === __APP_VERSION__ && <em>installée</em>}
            </header>
            <ul>
              {e.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ModalFrame>
  )
}
