// App/DOM messaging protocol, typechecked in both contexts.

import { DOMProtocol } from 'bike/core'

/** Names one row: the outline's root persistent id plus the row's session id. */
export type RowRef = { outline: string; row: number }

/** The linking row's text, split around the link so the view can mark it. */
export type Excerpt = { before: string; link: string; after: string }

export type BacklinkItem = {
  ref: RowRef
  /** Persistent id, when the row has one; a second way to match created dates. */
  pid?: string
  /** Character offset of the link, so Open lands the caret on it. */
  char: number
  excerpt: Excerpt
  /** Where the row lives. Empty for notes directly on a calendar day. */
  where: string
  /** `YYYYMMDD` of the calendar day page the row sits under, if any. */
  day?: string
  /** `YYYYMMDD` the link appeared this session; used only when Bike has no created date. */
  seen?: string
  /** Rows under the linking row, shown as notes. */
  notes: string[]
  /** Notes beyond those sent. */
  more: number
  /** True when the row already has a persistent id. Copying a link never mints one. */
  linkable: boolean
}

/** A row this one links to, from its own text or a note inside it. */
export type OutLink = {
  ref: RowRef
  text: string
  /** Where the target lives, as a short path. */
  where: string
  inside: boolean
  via?: string
  /** How many rows link to the target. */
  count: number
  /** Newest calendar day among the target's backlinks. */
  day?: string
  /** Target backlinks without a calendar day, for created-date lookup. */
  undated: { row: number; pid?: string; seen?: string }[]
}

/** A row inside the selected row that has backlinks: one bar on the leaderboard. */
export type InsideGroup = {
  ref: RowRef
  text: string
  count: number
  /** Newest calendar day among its backlinks. */
  day?: string
  /** Backlinks without a calendar day, for created-date lookup. */
  undated: { row: number; pid?: string; seen?: string }[]
}

export type BacklinksState = {
  target: { ref: RowRef; text: string } | null
  here: BacklinkItem[]
  out: OutLink[]
  inside: InsideGroup[]
}

export interface BacklinksProtocol extends DOMProtocol {
  toDOM: { type: 'state'; state: BacklinksState }
  toApp:
    | { type: 'ready' }
    | { type: 'go'; ref: RowRef; char?: number }
    | { type: 'focus'; ref: RowRef }
    | { type: 'copyLink'; ref: RowRef }
}

/** How the activity strip labels its start: "12 weeks ago", "3 months ago" or the date. */
export type StripLabel = 'weeks' | 'months' | 'date'
export const STRIP_LABELS: StripLabel[] = ['weeks', 'months', 'date']

export const backlinksDefaults = {
  showBadges: true,
  stripLabel: 'weeks',
}
