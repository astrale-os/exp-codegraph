import type { CatalogSpecEntry } from '../../viewer-host/catalog.ts'

import {
  navigationCurrentIdentity,
  navigationLocation,
  navigationModuleOwnsFolder,
} from './navigation-model.ts'
import { SPEC_TABS, type SpecTab } from './route.ts'

const SEARCH_TEXT_LIMIT = 8_192

export interface NavigationSearchEntry {
  readonly spec: CatalogSpecEntry
  readonly name: string
  readonly ownerPath?: string
  readonly family: string
  readonly normalizedFamily: string
  readonly normalizedStatus: string
  readonly normalizedName: string
  readonly normalizedTitle: string
  readonly normalizedPath: string
  readonly aliasText: string
  readonly aliasWords: ReadonlySet<string>
}

export interface NavigationSearchQuery {
  readonly terms: readonly string[]
  readonly text: string
  readonly families: readonly string[]
  readonly statuses: readonly string[]
  readonly tab?: SpecTab
}

export interface NavigationSearchResult {
  readonly entry: NavigationSearchEntry
  readonly direct: boolean
  readonly tier: number
  readonly score: number
  readonly recent: number
}

export interface NavigationSearchResults {
  readonly query: NavigationSearchQuery
  readonly items: readonly NavigationSearchResult[]
  readonly total: number
}

export function buildNavigationSearchIndex(
  specs: readonly CatalogSpecEntry[],
): readonly NavigationSearchEntry[] {
  return specs.map((spec) => {
    const location = navigationLocation(spec.source)
    const identity = navigationCurrentIdentity(spec.source, spec.title)
    const family = location.folders[0] ?? location.sourceName
    const owner = navigationModuleOwnsFolder(spec.source)
      ? location.folders.slice(0, -1)
      : location.folders
    const declarations = spec.apiDeclarationIdentities ?? []
    const aliasText = normalizeSearchValue(
      [
        spec.title,
        identity.name,
        location.sourceName,
        ...location.folders,
        ...declarations,
        spec.searchText?.slice(0, SEARCH_TEXT_LIMIT) ?? '',
      ].join(' '),
    )
    return {
      spec,
      name: identity.name,
      ...(owner.length ? { ownerPath: owner.join(' / ') } : {}),
      family,
      normalizedFamily: normalizeSearchValue(family),
      normalizedStatus: normalizeSearchValue(spec.metrics.status),
      normalizedName: normalizeSearchValue(identity.name),
      normalizedTitle: normalizeSearchValue(spec.title),
      normalizedPath: normalizeSearchValue(readableSourcePath(spec.source)),
      aliasText,
      aliasWords: new Set(aliasText.split(' ').filter(Boolean)),
    }
  })
}

export function parseNavigationSearchQuery(value: string): NavigationSearchQuery {
  const terms: string[] = []
  const families: string[] = []
  const statuses: string[] = []
  let tab: SpecTab | undefined
  for (const match of value.matchAll(/"([^"]+)"|(\S+)/g)) {
    const token = match[1] ?? match[2] ?? ''
    const separator = token.indexOf(':')
    const field = separator > 0 ? normalizeSearchValue(token.slice(0, separator)) : ''
    const fieldValue = separator > 0 ? normalizeSearchValue(token.slice(separator + 1)) : ''
    if (field === 'family' && fieldValue) {
      families.push(fieldValue)
    } else if (field === 'status' && fieldValue) {
      statuses.push(fieldValue)
    } else if ((field === 'tab' || field === 'section') && navigationSearchTab(fieldValue)) {
      tab = navigationSearchTab(fieldValue)
    } else {
      const normalized = normalizeSearchValue(token)
      if (normalized) terms.push(normalized)
    }
  }
  return { terms, text: terms.join(' '), families, statuses, ...(tab ? { tab } : {}) }
}

export function searchNavigationIndex(
  index: readonly NavigationSearchEntry[],
  value: string,
  recentSources: readonly string[] = [],
  limit = 40,
): NavigationSearchResults {
  const query = resolveNaturalNavigationTab(index, parseNavigationSearchQuery(value))
  const recent = new Map(
    recentSources.map((source, position) => [source, recentSources.length - position]),
  )
  const matches: NavigationSearchResult[] = []

  for (const entry of index) {
    if (
      query.families.length > 0 &&
      !query.families.some((family) => entry.normalizedFamily.startsWith(family))
    ) {
      continue
    }
    if (query.statuses.length > 0 && !query.statuses.includes(entry.normalizedStatus)) {
      continue
    }

    const ranking = rankEntry(entry, query)
    if (!ranking) continue
    matches.push({
      entry,
      direct: ranking.tier === 5,
      ...ranking,
      recent: recent.get(entry.spec.source) ?? 0,
    })
  }

  matches.sort(
    (left, right) =>
      right.tier - left.tier ||
      right.score - left.score ||
      right.recent - left.recent ||
      compare(left.entry.name, right.entry.name) ||
      compare(left.entry.spec.source, right.entry.spec.source),
  )
  return { query, items: matches.slice(0, limit), total: matches.length }
}

function resolveNaturalNavigationTab(
  index: readonly NavigationSearchEntry[],
  query: NavigationSearchQuery,
): NavigationSearchQuery {
  if (query.tab || query.terms.length < 2) return query
  const last = query.terms.at(-1)
  const tab = last ? navigationSearchTab(last) : undefined
  if (!tab) return query

  const exactModule = index.some(
    (entry) =>
      entry.normalizedName === query.text ||
      entry.normalizedTitle === query.text ||
      entry.normalizedPath === query.text,
  )
  if (exactModule) return query

  const terms = query.terms.slice(0, -1)
  return { ...query, terms, text: terms.join(' '), tab }
}

function navigationSearchTab(value: string): SpecTab | undefined {
  const exact = SPEC_TABS.find((candidate) => candidate === value)
  if (exact || value.length < 2) return exact
  const prefixes = SPEC_TABS.filter((candidate) => candidate.startsWith(value))
  return prefixes.length === 1 ? prefixes[0] : undefined
}

export function addRecentNavigationSource(
  sources: readonly string[],
  source: string,
  limit = 12,
): string[] {
  return [source, ...sources.filter((candidate) => candidate !== source)].slice(0, limit)
}

export function togglePinnedNavigationSource(
  sources: readonly string[],
  source: string,
  limit = 16,
): string[] {
  return sources.includes(source)
    ? sources.filter((candidate) => candidate !== source)
    : [...sources, source].slice(-limit)
}

function rankEntry(
  entry: NavigationSearchEntry,
  query: NavigationSearchQuery,
): { tier: number; score: number } | undefined {
  if (query.terms.length === 0) return { tier: 0, score: 0 }
  if (query.text === entry.normalizedName || query.text === entry.normalizedTitle) {
    return { tier: 5, score: 10_000 - Math.min(entry.normalizedTitle.length, 200) }
  }
  if (entry.normalizedPath.startsWith(query.text)) {
    return { tier: 4, score: 8_000 - Math.min(entry.normalizedPath.length, 400) }
  }

  let tier = 5
  let score = 0
  for (const term of query.terms) {
    const match = rankTerm(entry, term)
    if (!match) return
    tier = Math.min(tier, match.tier)
    score += match.score
  }
  return { tier, score }
}

function rankTerm(
  entry: NavigationSearchEntry,
  term: string,
): { tier: number; score: number } | undefined {
  if (entry.normalizedName === term || entry.normalizedTitle === term) {
    return { tier: 5, score: 1_000 }
  }
  if (
    entry.normalizedPath.startsWith(term) ||
    entry.normalizedPath.split(' ').some((segment) => segment.startsWith(term))
  ) {
    return { tier: 4, score: 800 - Math.min(entry.normalizedPath.length, 200) }
  }
  if (entry.aliasWords.has(term)) return { tier: 3, score: 620 }
  if (entry.aliasText.includes(term)) return { tier: 3, score: 520 }

  const fuzzy = Math.max(
    fuzzyScore(term, entry.normalizedName),
    fuzzyScore(term, entry.normalizedTitle),
    fuzzyScore(term, entry.normalizedPath),
  )
  return fuzzy > 0 ? { tier: 1, score: fuzzy } : undefined
}

function fuzzyScore(needle: string, candidate: string): number {
  if (!needle || needle.length > candidate.length) return 0
  let position = 0
  let previous = -2
  let score = 0
  for (const character of needle) {
    const next = candidate.indexOf(character, position)
    if (next < 0) return 0
    score += next === previous + 1 ? 12 : 4
    if (next === 0 || candidate[next - 1] === ' ') score += 8
    previous = next
    position = next + 1
  }
  return score - Math.min(candidate.length - needle.length, 80)
}

function readableSourcePath(source: string): string {
  return source
    .replace(/\/\.spec\/(?:api\.d\.ts|SPEC\.yml)$/, '')
    .replace(/\/\.spec\//, '/')
    .replace(/\/SPEC\.yml$/, '')
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function compare(left: string, right: string): number {
  const normalizedLeft = left.toLocaleLowerCase()
  const normalizedRight = right.toLocaleLowerCase()
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0
}
