import { useEffect, useRef, useState } from 'preact/hooks'

import type {
  CatalogIndex,
  CatalogSpecEntry,
  ViewerSpecification,
} from '../../viewer-host/catalog.ts'
import type { CatalogLoader } from './catalog.ts'

import { freeze } from './freeze.ts'

export interface CatalogSelection {
  readonly index: CatalogIndex
  readonly entry?: CatalogSpecEntry
  readonly spec?: ViewerSpecification
  readonly pending: boolean
  readonly error?: string
}

/** Keep one coherent index and selected Spec visible while a newer generation is loading. */
export function useCatalogSelection(
  nextIndex: CatalogIndex,
  loader: CatalogLoader,
  requestedSource?: string,
  suspended = false,
): CatalogSelection {
  const initialEntry = suspended ? undefined : selectEntry(nextIndex, requestedSource)
  const [selection, setSelection] = useState<CatalogSelection>({
    index: nextIndex,
    ...(initialEntry ? { entry: initialEntry, pending: true } : { pending: false }),
  })
  const current = useRef(selection)
  const transition = useRef(0)
  current.current = selection

  useEffect(() => {
    if (suspended) {
      transition.current++
      setSelection((value) => ({ ...value, index: nextIndex, pending: false, error: undefined }))
      return
    }
    const target = selectEntry(nextIndex, requestedSource)
    const active = current.current
    if (!target) {
      transition.current++
      setSelection({ index: nextIndex, pending: false })
      return
    }
    if (
      active.spec &&
      active.entry?.source === target.source &&
      active.entry.revision === target.revision
    ) {
      if (active.index.generation !== nextIndex.generation || active.entry !== target) {
        setSelection({ index: nextIndex, entry: target, spec: active.spec, pending: false })
      }
      return
    }

    const id = ++transition.current
    setSelection((value) => ({
      ...value,
      ...(!value.spec ? { index: nextIndex, entry: target } : {}),
      pending: true,
      error: undefined,
    }))
    void loader.load(target).then(
      (spec) => {
        if (transition.current !== id) return
        setSelection({ index: nextIndex, entry: target, spec: freeze(spec), pending: false })
      },
      (error: unknown) => {
        if (transition.current !== id) return
        setSelection((value) => ({
          ...value,
          ...(!value.spec ? { index: nextIndex, entry: target } : {}),
          pending: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      },
    )
  }, [loader, nextIndex, nextIndex.generation, requestedSource, suspended])

  return selection
}

function selectEntry(index: CatalogIndex, source?: string): CatalogSpecEntry | undefined {
  return index.specs.find((entry) => entry.source === source) ?? index.specs[0]
}
