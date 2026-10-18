// Pure text helpers shared by the app context and tests. No Bike globals here.

import { Excerpt } from './protocol'

const AP_MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']

export type DayParts = { year: number; month: number; day: number }

/**
 * Calendar day rows carry persistent ids like `2026/10/01`. A month or day of
 * `00` marks year, month and week rows, which are not days.
 */
export function dayFromId(id: string | undefined): DayParts | null {
  if (!id) return null
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(id)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/** Sortable key for a day, newest compares greatest. */
export function dayKey(d: DayParts): string {
  return `${d.year}${String(d.month).padStart(2, '0')}${String(d.day).padStart(2, '0')}`
}

/** AP style date: "Oct. 1", adding the year when it isn't the current one. */
export function apDate(d: DayParts, currentYear: number): string {
  const base = `${AP_MONTHS[d.month - 1]} ${d.day}`
  return d.year === currentYear ? base : `${base}, ${d.year}`
}

/** Link text that is only a URL reads badly, so name the target instead. */
export function displayLinkText(runText: string, targetText: string): string {
  const t = runText.trim()
  if (!t || /^(bike|https?):\/\//i.test(t) || /^#\S+$/.test(t)) return targetText.trim() || t
  return t
}

/**
 * Trim a row's text to one readable line around the link. Keeps a short
 * lead-in, cut at a word boundary, and leaves the tail to CSS ellipsis.
 */
export function makeExcerpt(text: string, start: number, end: number, link: string, lead = 28, tail = 160): Excerpt {
  let before = text.slice(0, start)
  if (before.length > lead) {
    let cut = before.length - lead
    const space = before.indexOf(' ', cut)
    if (space !== -1 && space < before.length - 1) cut = space + 1
    before = '…' + before.slice(cut)
  }
  let after = text.slice(end)
  if (after.length > tail) after = after.slice(0, tail).trimEnd() + '…'
  return { before, link, after }
}

/** Collapse whitespace and cap length. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

/** Only ids made of plain characters go into a badge's outline path. */
export function isPathSafeId(id: string): boolean {
  return /^[A-Za-z0-9_\-\/.:]+$/.test(id)
}

/**
 * The row a `bike://` URL points at: the selection fragment when present,
 * else the focus path. Percent escapes are decoded.
 */
export function rowRefFromURL(path: string | undefined, fragment: string | undefined): string | null {
  const raw = fragment && fragment.length > 0 ? fragment : (path ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
