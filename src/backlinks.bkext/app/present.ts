import { Row } from 'bike/app'
import { BacklinkItem, BacklinksState, InsideGroup, OutLink, RowRef } from '../dom/lib/protocol'
import { clip, dayFromId, dayKey, DayParts, displayLinkText, makeExcerpt } from '../dom/lib/format'
import { Link, OutlineIndex } from './index'

const NOTES = 8
const UNDATED_LOOKUP = 40

/**
 * A row's ancestors from the top level down, excluding the outline root.
 * Built from parent links so it doesn't depend on the order Bike lists ancestors in.
 */
export function lineage(row: Row): Row[] {
  const out: Row[] = []
  for (let r = row.parent; r && r.parent; r = r.parent) out.unshift(r)
  return out
}

/** The nearest calendar day at or above a row, with the rows between. */
function dayContext(row: Row): { day: DayParts; between: Row[] } | null {
  const chain = lineage(row)
  for (let i = chain.length - 1; i >= 0; i--) {
    const day = dayFromId(chain[i].persistentId)
    if (day) return { day, between: chain.slice(i + 1) }
  }
  return null
}

/** Position in outline order, as a comparable array of sibling indexes. */
function orderPath(row: Row): number[] {
  const path: number[] = []
  let r: Row | undefined = row
  while (r && r.parent) {
    const parent: Row = r.parent
    const id = r.id
    path.unshift(parent.children.findIndex((c) => c.id === id))
    r = parent
  }
  return path
}

function compareOrder(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

function ref(key: string, row: Row): RowRef {
  return { outline: key, row: row.id }
}

export function toItem(link: Link, key: string, index?: OutlineIndex): BacklinkItem {
  const source = link.source
  const text = source.text.string
  const ctx = dayContext(source)
  const parent = source.parent
  const where = ctx
    ? ctx.between.map((r) => clip(r.text.string, 48)).join(' › ')
    : parent && parent.id !== source.outline.root.id
      ? clip(parent.text.string, 64)
      : 'Top level'
  const children = source.children
  return {
    ref: ref(key, source),
    pid: source.persistentId,
    char: link.start,
    excerpt: makeExcerpt(text, link.start, link.end, displayLinkText(link.text, link.target.text.string), 90, 320),
    where,
    day: ctx ? dayKey(ctx.day) : undefined,
    seen: index?.appearedOn(source.id),
    notes: children.slice(0, NOTES).map((c) => clip(c.text.string, 220)),
    more: Math.max(0, children.length - NOTES),
    linkable: source.persistentId !== undefined,
  }
}

/** Newest calendar days first, then everything else in outline order. */
export function sortLinks(links: Link[]): Link[] {
  if (links.length < 2) return links
  const keyed = links.map((link) => {
    const ctx = dayContext(link.source)
    return { link, day: ctx ? dayKey(ctx.day) : '', order: undefined as number[] | undefined }
  })
  const order = (k: (typeof keyed)[number]) => (k.order ??= orderPath(k.link.source))
  keyed.sort((a, b) => {
    if (a.day !== b.day) {
      if (a.day && b.day) return a.day < b.day ? 1 : -1
      return a.day ? -1 : 1
    }
    return compareOrder(order(a), order(b))
  })
  return keyed.map((k) => k.link)
}

/** Rows a view displays, so a text edit refreshes only views that show it. */
export type Built = { state: BacklinksState; shown: Set<number> }

export function buildState(index: OutlineIndex, row: Row | undefined): Built {
  const key = index.key
  const shown = new Set<number>()
  if (!row || !key || row.id === index.outline.root.id) {
    return { state: { target: null, here: [], out: [], inside: [] }, shown }
  }
  shown.add(row.id)

  // Backlinks to this row.
  const hereLinks = sortLinks(index.linksTo(row))
  for (const l of hereLinks) {
    shown.add(l.source.id)
    for (const c of l.source.children.slice(0, NOTES)) shown.add(c.id)
    for (const a of l.source.ancestors) shown.add(a.id)
  }
  const here = hereLinks.map((l) => toItem(l, key, index))

  // Where this row links to.
  const out: OutLink[] = index.linksFrom(row).map((l) => {
    shown.add(l.target.id)
    shown.add(l.source.id)
    const inside = l.source.id !== row.id
    const ancestors = lineage(l.target)
    let day: string | undefined
    const undated: { row: number; pid?: string; seen?: string }[] = []
    const incoming = index.linksTo(l.target)
    for (const back of incoming) {
      const ctx = dayContext(back.source)
      if (ctx) {
        const k = dayKey(ctx.day)
        if (!day || k > day) day = k
      } else if (undated.length < UNDATED_LOOKUP) {
        undated.push({ row: back.source.id, pid: back.source.persistentId, seen: index.appearedOn(back.source.id) })
      }
    }
    return {
      ref: ref(key, l.target),
      text: clip(l.target.text.string, 60),
      where: ancestors.slice(-2).map((r) => clip(r.text.string, 28)).join(' › ') || 'Top level',
      inside,
      via: inside ? clip(l.source.text.string, 80) : undefined,
      count: incoming.length,
      day,
      undated,
    }
  })

  // Rows inside this one that have backlinks: the leaderboard.
  const inside: { group: InsideGroup; order: number[] }[] = []
  if (row.firstChild) {
    for (const links of index.all().values()) {
      const target = links[0].target
      if (target.id === row.id) continue
      if (!target.ancestors.some((a) => a.id === row.id)) continue
      shown.add(target.id)
      let day: string | undefined
      const undated: { row: number; pid?: string; seen?: string }[] = []
      for (const l of links) {
        const ctx = dayContext(l.source)
        if (ctx) {
          const k = dayKey(ctx.day)
          if (!day || k > day) day = k
        } else if (undated.length < UNDATED_LOOKUP) {
          undated.push({ row: l.source.id, pid: l.source.persistentId, seen: index.appearedOn(l.source.id) })
        }
      }
      inside.push({
        order: orderPath(target),
        group: { ref: ref(key, target), text: clip(target.text.string, 80), count: links.length, day, undated },
      })
    }
  }
  inside.sort((a, b) => compareOrder(a.order, b.order))

  return {
    state: {
      target: { ref: ref(key, row), text: clip(row.text.string, 120) },
      here,
      out,
      inside: inside.map((i) => i.group),
    },
    shown,
  }
}
