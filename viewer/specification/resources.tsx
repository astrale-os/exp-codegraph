import { useState } from 'preact/hooks'

import type { SchemaResource } from '../../specification/resource/index.ts'

import { RawSource } from '../source/raw.tsx'

type SourceResource = SchemaResource

export function SourceResourcesView({ resources }: { resources: readonly SourceResource[] }) {
  const [selectedRef, setSelectedRef] = useState(resources[0]?.ref)
  const selected = resources.find((resource) => resource.ref === selectedRef) ?? resources[0]
  if (!selected) return null
  return (
    <div class="spec-resource-view">
      {resources.length > 1 && (
        <nav class="api-source-tabs" aria-label="Resource files">
          {resources.map((resource) => (
            <button
              type="button"
              class={resource.ref === selected.ref ? 'selected' : undefined}
              onClick={() => setSelectedRef(resource.ref)}
              key={resource.ref}
            >
              {resource.ref}
            </button>
          ))}
        </nav>
      )}
      <RawSource name={selected.source} text={selected.text} />
    </div>
  )
}
