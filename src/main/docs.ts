import { app, net } from 'electron'
import fs from 'fs'
import path from 'path'
import { pullModel } from './ollama'

// Recherche dans la documentation (RAG) : Wikibooks LaTeX (en + fr) + fichiers perso de userData/docs,
// découpés en passages, vectorisés par embeddinggemma via Ollama.
// ponytail: recherche linéaire en mémoire (quelques milliers de passages), passer à un index ANN si ça dépasse ~100k

const OLLAMA = 'http://127.0.0.1:11434'
const EMBED_MODEL = 'embeddinggemma'
const WIKIS = ['https://en.wikibooks.org', 'https://fr.wikibooks.org']
const CHUNK = 1500

type Chunk = { title: string; url: string; text: string }
type Index = { chunks: Chunk[]; vecs: number[][] }

const indexFile = (): string => path.join(app.getPath('userData'), 'docs-index.json')
export const userDocsDir = (): string => path.join(app.getPath('userData'), 'docs')

let index: Index | null | undefined

function load(): Index | null {
  if (index === undefined) {
    try {
      index = JSON.parse(fs.readFileSync(indexFile(), 'utf8')) as Index
    } catch {
      index = null
    }
  }
  return index
}

export function docsStatus(): { chunks: number; dir: string } {
  return { chunks: load()?.chunks.length ?? 0, dir: userDocsDir() }
}

async function json<T>(url: string, body?: unknown): Promise<T> {
  const res = await net.fetch(url, body ? { method: 'POST', body: JSON.stringify(body) } : undefined)
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

async function embed(input: string[]): Promise<number[][]> {
  try {
    return (await json<{ embeddings: number[][] }>(`${OLLAMA}/api/embed`, { model: EMBED_MODEL, input })).embeddings
  } catch (e) {
    if (/not found/i.test((e as Error).message)) throw new Error(`Modèle manquant : lancez « ollama pull ${EMBED_MODEL} »`)
    if (/fetch failed|ECONNREFUSED/i.test((e as Error).message)) throw new Error('Ollama injoignable : lancez Ollama')
    throw e
  }
}

/** Wikitext → texte lisible, en gardant les exemples de code */
function clean(wiki: string): string {
  return wiki
    .replace(/<noinclude>[\s\S]*?<\/noinclude>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/<\/?(syntaxhighlight|source|pre)[^>]*>/g, '\n```\n')
    .replace(/<\/?(code|tt|kbd|nowiki)>/g, '`')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\S+ ([^\]]*)\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\n{3,}/g, '\n\n')
}

/** Découpe par sections (== Titre ==), puis par paragraphes pour rester sous CHUNK caractères */
function split(title: string, url: string, text: string): Chunk[] {
  const out: Chunk[] = []
  for (const section of text.split(/\n(?==+[^=\n]+=+\s*\n)/)) {
    const heading = /^=+\s*([^=\n]+?)\s*=+/.exec(section)?.[1]
    const t = heading ? `${title} › ${heading}` : title
    let cur = ''
    for (const para of section.split(/\n\n/)) {
      if (cur && cur.length + para.length > CHUNK) {
        out.push({ title: t, url, text: cur.trim() })
        cur = ''
      }
      cur += para + '\n\n'
    }
    if (cur.trim().length > 80) out.push({ title: t, url, text: cur.trim().slice(0, CHUNK * 2) })
  }
  return out
}

export async function buildDocs(onProgress: (msg: string) => void): Promise<number> {
  // Modèle d'embedding absent (nouvel ordinateur) : téléchargé automatiquement (≈ 0,6 Go)
  const show = await net.fetch(`${OLLAMA}/api/show`, { method: 'POST', body: JSON.stringify({ model: EMBED_MODEL }) }).catch(() => null)
  if (!show) throw new Error('Ollama injoignable : lancez Ollama')
  if (!show.ok) await pullModel(EMBED_MODEL, (msg) => onProgress(`Téléchargement du modèle de recherche — ${msg}`))

  const chunks: Chunk[] = []
  for (const wiki of WIKIS) {
    const list = await json<{ query: { allpages: { title: string }[] } }>(
      `${wiki}/w/api.php?action=query&list=allpages&apprefix=LaTeX/&apnamespace=0&aplimit=500&format=json`
    )
    const pages = list.query.allpages
    for (const [i, p] of pages.entries()) {
      onProgress(`Téléchargement ${wiki.slice(8, 10)} ${i + 1}/${pages.length} : ${p.title}`)
      const url = `${wiki}/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`
      const res = await net.fetch(`${url}?action=raw`)
      if (res.ok) chunks.push(...split(p.title, url, clean(await res.text())))
    }
  }

  fs.mkdirSync(userDocsDir(), { recursive: true })
  for (const name of fs.readdirSync(userDocsDir())) {
    if (!/\.(txt|md|tex)$/i.test(name)) continue
    const file = path.join(userDocsDir(), name)
    chunks.push(...split(name, file, fs.readFileSync(file, 'utf8')))
  }

  const vecs: number[][] = []
  for (let i = 0; i < chunks.length; i += 32) {
    onProgress(`Indexation ${i}/${chunks.length} passages`)
    vecs.push(...(await embed(chunks.slice(i, i + 32).map((c) => `title: ${c.title} | text: ${c.text}`))))
  }
  index = { chunks, vecs }
  fs.writeFileSync(indexFile(), JSON.stringify(index))
  onProgress(`Terminé : ${chunks.length} passages`)
  return chunks.length
}

const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0)

/** Les k passages les plus proches de la question (vide si pas d'index) */
export async function searchDocs(query: string, k = 6): Promise<Chunk[]> {
  const idx = load()
  if (!idx?.chunks.length) return []
  const [q] = await embed([`task: search result | query: ${query}`])
  // embeddinggemma renvoie des vecteurs normalisés : produit scalaire = cosinus
  return idx.vecs
    .map((v, i) => ({ i, s: dot(q, v) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map(({ i }) => idx.chunks[i])
}
