import type { ComponentChildren } from 'preact'

import { useEffect, useState } from 'preact/hooks'

interface ViewerModuleSurface {
  readonly id: string
  readonly name: string
  readonly specifier?: string
  readonly api?: {
    readonly model?: {
      readonly sources: readonly { readonly file: string }[]
    }
  }
}

export function ModuleSurface<Module extends ViewerModuleSurface>({
  modules,
  initialId,
  render,
}: {
  modules: readonly Module[]
  initialId?: string
  render(module: Module): ComponentChildren
}) {
  const fallback = modules.find((module) => module.id === initialId) ?? modules[0]
  const [selectedId, setSelectedId] = useState(fallback?.id)
  useEffect(() => {
    if (modules.some((module) => module.id === selectedId)) return
    setSelectedId(fallback?.id)
  }, [fallback?.id, modules, selectedId])
  const selected = modules.find((module) => module.id === selectedId) ?? fallback
  if (!selected) return null
  return (
    <section class="spec-module-surface">
      {modules.length > 1 && (
        <nav class="api-source-tabs spec-module-tabs" aria-label="Specification modules">
          {modules.map((module) => (
            <button
              type="button"
              class={module.id === selected.id ? 'selected' : ''}
              title={module.specifier ?? module.name}
              onClick={() => setSelectedId(module.id)}
              key={module.id}
            >
              <span class="api-ts-icon">TS</span>
              {moduleLabel(module, modules[0]?.name)}
            </button>
          ))}
        </nav>
      )}
      {render(selected)}
    </section>
  )
}

export function moduleForSource<Module extends ViewerModuleSurface>(
  modules: readonly Module[],
  source: string | undefined,
): Module | undefined {
  if (!source) return
  return modules.find((module) =>
    module.api?.model?.sources.some((candidate) => candidate.file === source),
  )
}

function moduleLabel(module: ViewerModuleSurface, primaryName: string | undefined): string {
  const prefix = primaryName ? `${primaryName}.` : ''
  return prefix && module.name.startsWith(prefix) ? module.name.slice(prefix.length) : module.name
}
