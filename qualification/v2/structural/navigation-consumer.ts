import type { TypeScriptSemanticReader } from '@astrale-os/codegraph/analysis/typescript'

type StructuralReader = Awaited<ReturnType<TypeScriptSemanticReader['structure']>>
export type NavigationInspectionInput = Omit<Parameters<StructuralReader['symbolAt']>[0], 'signal'>

/** An editor/diagnostic consumer starting with a source position, not an export name. */
export async function inspectSourceSymbol(read: TypeScriptSemanticReader, input: NavigationInspectionInput) {
  const structure = await read.structure()
  const navigation = await structure.symbolAt(input)
  const references = await structure.references({ target: input })
  // Preserve canonical declarations, source revisions, evidence and uncertainty.
  // The consumer creates no compiler program or position/symbol index.
  return { navigation, references }
}
