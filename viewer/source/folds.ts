import type { EditorView } from '@codemirror/view'

import { foldEffect, foldedRanges } from '@codemirror/language'

export function persistFolds(source: string, view: EditorView): void {
  try {
    const ranges: Array<{ from: number; to: number }> = []
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      ranges.push({ from, to })
    })
    localStorage.setItem(foldKey(source), JSON.stringify(ranges))
  } catch {
    // Storage may be unavailable in hardened browser contexts.
  }
}

export function restoreFolds(source: string, view: EditorView): void {
  try {
    const raw = localStorage.getItem(foldKey(source))
    if (!raw) return
    const ranges = JSON.parse(raw) as Array<{ from?: unknown; to?: unknown }>
    const effects = ranges
      .filter(
        (range): range is { from: number; to: number } =>
          Number.isInteger(range.from) &&
          Number.isInteger(range.to) &&
          Number(range.from) >= 0 &&
          Number(range.to) > Number(range.from) &&
          Number(range.to) <= view.state.doc.length,
      )
      .map((range) => foldEffect.of(range))
    if (effects.length) view.dispatch({ effects })
  } catch {
    try {
      localStorage.removeItem(foldKey(source))
    } catch {
      // Storage may be unavailable in hardened browser contexts.
    }
  }
}

function foldKey(source: string): string {
  return `astrale-spec:folds:${source}`
}
