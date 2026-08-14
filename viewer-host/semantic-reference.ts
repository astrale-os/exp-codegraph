import type { CatalogSemanticReference } from './catalog.ts'

/** One canonical browser route for catalog-derived declaration links. */
export function semanticReferenceHref(reference: CatalogSemanticReference): string {
  const parameters = new URLSearchParams()
  parameters.set('spec', reference.target.spec)
  parameters.set('tab', 'api')
  parameters.set('apiFile', reference.target.source)
  parameters.set('apiDecl', reference.target.declaration)
  return `?${parameters}`
}
