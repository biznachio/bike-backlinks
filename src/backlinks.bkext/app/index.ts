import { Disposable, Outline, Row, RowRun } from 'bike/app'
import { rowRefFromURL } from '../dom/lib/format'

/** One link from a source row to a target row in the same outline. */
export type Link = {
  source: Row
  target: Row
  /** Character range of the link in the source row's text. */
  start: number
  end: number
  /** The link's visible text. */
  text: string
}

/** What changed since the last notification. */
export type IndexChange = {
  /** The set of links changed: added, removed, retargeted or moved within their row. */
  linksChanged: boolean
  /** Rows whose text changed, plus parents that gained children. */
  touched: Set<number>
  /** Rows were moved or removed, so any view may be affected. */
  structural: boolean
}

/** Key for a row: its persistent id when it has one, else its session id. */
export function rowKey(row: Row): string {
  return row.persistentId ?? `#${row.id}`
}

/**
 * Backlinks for one outline. Read-only: it never writes to the outline and
 * never mints persistent ids. Links are found with Bike's own run query and
 * resolved with Bike's own link resolver, so `bike://` URLs and `#rowid`
 * shorthand both count. Links to other files, web links and self-links are
 * ignored. A row linking to the same target more than once counts once.
 */
export class OutlineIndex {
  readonly outline: Outline
  private byTarget = new Map<string, Link[]>()
  private bySource = new Map<number, Link[]>()
  private dirty = true
  private timer: ReturnType<typeof setTimeout> | undefined
  private observer: Disposable
  private listeners = new Set<(change: IndexChange) => void>()
  private touched = new Set<number>()
  private structural = false
  private signature = ''
  /** Source rows seen in a scan, and the day new ones first appeared this session. */
  private knownSources: Set<number> | undefined
  private appeared = new Map<number, string>()

  constructor(outline: Outline) {
    this.outline = outline
    // Rescan after edits settle. The run query is native and fast, and a full
    // rescan can't drift out of sync the way piecemeal updates can.
    this.observer = outline.observeChanges((change) => {
      switch (change.type) {
        case 'beginTransaction':
        case 'endTransaction':
        case 'metadata':
          return
        case 'rowChanged':
          // Attribute and type changes (done, status, headings) can't affect links.
          if (change.change.type === 'setAttribute' || change.change.type === 'setType') return
          this.touched.add(change.rowId)
          break
        case 'siblingsInserted':
          for (const parent of new Set(change.siblings.map((r) => r.parent?.id))) if (parent !== undefined) this.touched.add(parent)
          break
        default:
          this.structural = true
      }
      this.dirty = true
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.settle(), 300)
    })
    this.refresh()
  }

  /** Rescan once edits settle, then tell listeners what kind of change it was. */
  private settle() {
    this.timer = undefined
    this.refresh()
    const signature = this.computeSignature()
    const change: IndexChange = {
      linksChanged: signature !== this.signature,
      touched: this.touched,
      structural: this.structural,
    }
    this.signature = signature
    this.touched = new Set()
    this.structural = false
    for (const listener of this.listeners) listener(change)
  }

  private computeSignature(): string {
    const parts: string[] = []
    for (const [key, links] of this.byTarget) parts.push(key + '<' + links.map((l) => `${l.source.id}:${l.start}-${l.end}`).join(','))
    return parts.join('|')
  }

  /** The outline's key, or undefined when its root has no persistent id (no row links can resolve). */
  get key(): string | undefined {
    return this.outline.root.persistentId
  }

  onChange(listener: (change: IndexChange) => void): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    this.observer.dispose()
    this.listeners.clear()
    this.byTarget.clear()
    this.bySource.clear()
  }

  /** Links pointing at `row`, one per source row, in outline order. */
  linksTo(row: Row): Link[] {
    this.refresh()
    return this.byTarget.get(rowKey(row)) ?? []
  }

  /**
   * Where a row points: its own links first, then links in rows inside it,
   * one entry per target.
   */
  linksFrom(row: Row, limit = 24): Link[] {
    this.refresh()
    const seen = new Set<number>()
    const out: Link[] = []
    const add = (l: Link) => {
      if (l.target.id === row.id || seen.has(l.target.id) || out.length >= limit) return
      seen.add(l.target.id)
      out.push(l)
    }
    for (const l of this.bySource.get(row.id) ?? []) add(l)
    if (row.firstChild) {
      for (const [sourceId, links] of this.bySource) {
        if (sourceId === row.id) continue
        if (!links[0].source.ancestors.some((a) => a.id === row.id)) continue
        for (const l of links) add(l)
      }
    }
    return out
  }

  /** `YYYYMMDD` of the day a linking row first appeared this session, if it did. */
  appearedOn(sourceId: number): string | undefined {
    return this.appeared.get(sourceId)
  }

  /** Every target row with backlinks, mapped to its links. */
  all(): Map<string, Link[]> {
    this.refresh()
    return this.byTarget
  }

  private refresh() {
    if (!this.dirty) return
    this.dirty = false
    this.byTarget = this.scan()
    this.bySource = new Map()
    for (const links of this.byTarget.values()) {
      for (const l of links) {
        let list = this.bySource.get(l.source.id)
        if (!list) this.bySource.set(l.source.id, (list = []))
        list.push(l)
      }
    }
    for (const list of this.bySource.values()) list.sort((a, b) => a.start - b.start)
    // The first scan is the baseline. A linking row that shows up after it was written
    // while Bike was open, so it is dated today when Bike has no created date for it.
    const now = new Date()
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const sources = new Set(this.bySource.keys())
    if (this.knownSources) for (const id of sources) if (!this.knownSources.has(id) && !this.appeared.has(id)) this.appeared.set(id, today)
    this.knownSources = sources
    if (!this.signature) this.signature = this.computeSignature()
  }

  private scan(): Map<string, Link[]> {
    const result = new Map<string, Link[]>()
    const rootId = this.outline.root.persistentId
    if (!rootId) return result

    const value = this.outline.query('//*/run::@a')
    if (value.type !== 'elements') return result

    // Merge adjacent runs carrying the same link (formatting splits runs).
    type Raw = { row: Row; href: string; start: number; end: number; text: string }
    const raws: Raw[] = []
    for (const el of value.value) {
      const run = el as RowRun
      if (!run || !run.row || typeof run.runStart !== 'number') continue
      const href = run.runAttributes?.['a']
      if (!href) continue
      const last = raws[raws.length - 1]
      const end = run.runStart + run.runString.length
      if (last && last.row.id === run.row.id && last.href === href && last.end === run.runStart) {
        last.end = end
        last.text += run.runString
      } else {
        raws.push({ row: run.row, href, start: run.runStart, end, text: run.runString })
      }
    }

    for (const raw of raws) {
      const url = this.outline.resolveLink(raw.href)
      if (!url || url.scheme !== 'bike') continue
      if (url.host && url.host !== rootId) continue // another file
      const ref = rowRefFromURL(url.path, url.fragment)
      if (!ref) continue
      const target = this.outline.getRowById(ref)
      if (!target || target.id === this.outline.root.id) continue
      if (target.id === raw.row.id) continue // self-link
      const key = rowKey(target)
      let list = result.get(key)
      if (!list) result.set(key, (list = []))
      if (list.some((l) => l.source.id === raw.row.id)) continue // one per source row
      list.push({ source: raw.row, target, start: raw.start, end: raw.end, text: raw.text })
    }
    return result
  }
}
