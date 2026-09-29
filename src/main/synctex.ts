import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import type { SyncForwardResult, SyncRect, SyncReverseResult } from '../shared/types'

/**
 * Parseur SyncTeX minimal.
 * Coordonnées SyncTeX : points d'échelle (sp) depuis le coin supérieur gauche de la page,
 * marges d'un pouce incluses. On convertit en points PostScript (bp) : 1 bp = 65781.76 sp.
 */

interface SRecord {
  type: string // '[' '(' 'h' 'v' 'x' 'k' 'g' '$'
  tag: number
  line: number
  h: number
  v: number
  W: number
  H: number
  D: number
}

interface SyncData {
  inputs: Map<number, string>
  pages: Map<number, SRecord[]>
}

const cache = new Map<string, { mtime: number; data: SyncData }>()

const RECORD = /^([[(vhxkg$])(\d+),(\d+):(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/

function load(synctexPath: string): SyncData | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(synctexPath)
  } catch {
    return null
  }
  const hit = cache.get(synctexPath)
  if (hit && hit.mtime === stat.mtimeMs) return hit.data

  let text: string
  const buf = fs.readFileSync(synctexPath)
  text = synctexPath.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8')

  const inputs = new Map<number, string>()
  const pages = new Map<number, SRecord[]>()
  let unit = 1
  let mag = 1000
  let xOff = 0
  let yOff = 0
  let page = 0
  let records: SRecord[] = []

  for (const line of text.split('\n')) {
    if (line.startsWith('Input:')) {
      const m = /^Input:(\d+):(.*)$/.exec(line)
      if (m && m[2]) inputs.set(Number(m[1]), m[2])
      continue
    }
    if (page === 0) {
      if (line.startsWith('Unit:')) unit = Number(line.slice(5)) || 1
      else if (line.startsWith('Magnification:')) mag = Number(line.slice(14)) || 1000
      else if (line.startsWith('X Offset:')) xOff = Number(line.slice(9)) || 0
      else if (line.startsWith('Y Offset:')) yOff = Number(line.slice(9)) || 0
    }
    const c = line[0]
    if (c === '{') {
      page = Number(line.slice(1))
      records = []
      continue
    }
    if (c === '}') {
      pages.set(page, records)
      continue
    }
    const m = RECORD.exec(line)
    if (m && page) {
      const f = (unit * mag) / 1000 / 65781.76
      records.push({
        type: m[1],
        tag: Number(m[2]),
        line: Number(m[3]),
        h: (Number(m[4]) + xOff) * f,
        v: (Number(m[5]) + yOff) * f,
        W: m[6] ? Number(m[6]) * f : 0,
        H: m[7] ? Number(m[7]) * f : 0,
        D: m[8] ? Number(m[8]) * f : 0
      })
    }
  }
  const data = { inputs, pages }
  cache.set(synctexPath, { mtime: stat.mtimeMs, data })
  return data
}

function normalize(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

function tagsFor(data: SyncData, file: string): number[] {
  const target = normalize(file)
  const tags: number[] = []
  for (const [tag, p] of data.inputs) {
    const candidates = [p, p + '.tex']
    if (candidates.some((c) => normalize(c) === target)) tags.push(tag)
  }
  return tags
}

export function forwardSearch(synctexPath: string, file: string, line: number): SyncForwardResult | null {
  const data = load(synctexPath)
  if (!data) return null
  const tags = new Set(tagsFor(data, file))
  if (!tags.size) return null

  // Chercher la ligne exacte, sinon la plus proche en dessous puis au-dessus
  let best: { page: number; recs: SRecord[]; dist: number } | null = null
  for (const [page, recs] of data.pages) {
    for (const r of recs) {
      if (!tags.has(r.tag)) continue
      const dist = r.line === line ? 0 : r.line < line ? (line - r.line) * 2 : (r.line - line) * 2 + 1
      if (!best || dist < best.dist) best = { page, recs: [], dist }
    }
  }
  if (!best) return null
  const bestDist = best.dist
  const targetLine = bestDist === 0 ? line : bestDist % 2 === 0 ? line - bestDist / 2 : line + (bestDist - 1) / 2

  // Regrouper le contenu de la ligne source par ligne de base, puis surligner la ligne visuelle entière
  const pagesSorted = [...data.pages.keys()].sort((a, b) => a - b)
  for (const page of pagesSorted) {
    const all = data.pages.get(page)!
    const recs = all.filter((r) => tags.has(r.tag) && r.line === targetLine)
    if (!recs.length) continue
    let content = recs.filter((r) => 'xkg$h'.includes(r.type))
    if (!content.length) content = recs
    const baselines: SRecord[][] = []
    for (const r of content) {
      const g = baselines.find((b) => Math.abs(b[0].v - r.v) < 1)
      if (g) g.push(r)
      else baselines.push([r])
    }
    const rects: SyncRect[] = []
    for (const group of baselines.slice(0, 20)) {
      const v = group[0].v
      const minX = Math.min(...group.map((r) => r.h))
      const maxX = Math.max(...group.map((r) => r.h + r.W))
      let line: SRecord | null = null
      for (const b of all) {
        if (b.type !== '(' || Math.abs(b.v - v) > 1 || minX < b.h - 1 || minX > b.h + b.W + 1) continue
        if (!line || b.W > line.W) line = b
      }
      if (line) rects.push({ x: line.h, y: line.v - Math.max(line.H, 7), w: Math.max(line.W, 4), h: Math.max(line.H, 7) + Math.max(line.D, 2) })
      else rects.push({ x: minX, y: v - 8, w: Math.max(20, maxX - minX), h: 11 })
    }
    return { page, rects: mergeRects(rects) }
  }
  return null
}

function mergeRects(rects: SyncRect[]): SyncRect[] {
  // Éliminer les boîtes englobant tout le texte (paragraphes entiers) si des boîtes plus fines existent
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const out: SyncRect[] = []
  for (const r of sorted) {
    const dup = out.find((o) => Math.abs(o.x - r.x) < 0.5 && Math.abs(o.y - r.y) < 0.5 && Math.abs(o.w - r.w) < 0.5)
    if (!dup) out.push(r)
  }
  return out.slice(0, 40)
}

export function reverseSearch(synctexPath: string, page: number, x: number, y: number): SyncReverseResult | null {
  const data = load(synctexPath)
  if (!data) return null
  const recs = data.pages.get(page)
  if (!recs?.length) return null

  // Plus petite boîte horizontale contenant le point
  let box: SRecord | null = null
  for (const r of recs) {
    if (r.type !== '(' && r.type !== 'h') continue
    const top = r.v - r.H - 1
    const bottom = r.v + r.D + 1
    if (x >= r.h - 1 && x <= r.h + r.W + 1 && y >= top && y <= bottom) {
      if (!box || r.W * (r.H + r.D) < box.W * (box.H + box.D)) box = r
    }
  }

  // Dans cette boîte (ou la page), l'enregistrement le plus proche horizontalement sur la même ligne de base
  let best: SRecord | null = null
  let bestScore = Infinity
  for (const r of recs) {
    if (r.type === '[' || r.type === 'v') continue
    if (!data.inputs.has(r.tag)) continue
    let score: number
    if (box) {
      if (Math.abs(r.v - box.v) > 0.5 || r.h < box.h - 1 || r.h > box.h + box.W + 1) continue
      // privilégier l'élément qui commence juste avant le point cliqué
      score = r.h <= x ? x - r.h : (r.h - x) * 3
    } else {
      score = Math.abs(r.v - y) * 3 + Math.abs(r.h - x)
    }
    if (score < bestScore) {
      bestScore = score
      best = r
    }
  }
  const hit = best ?? box
  if (!hit) return null
  const file = data.inputs.get(hit.tag)
  if (!file) return null
  const resolved = fs.existsSync(file) ? file : fs.existsSync(file + '.tex') ? file + '.tex' : file
  return { file: resolved, line: hit.line }
}
