import type { TypeScriptSemanticReader } from '@astrale-os/codegraph/analysis/typescript'

export interface StructuralInspectionInput {
  /** The API's declaring file or a public barrel exporting it. */
  readonly path: string
  readonly name: string
  /** File whose direct and transitive users should be reported. */
  readonly module: string
}

/** Public-package consumer: no source parsing or consumer-owned semantic index. */
export async function inspectStructuralAPI(read: TypeScriptSemanticReader, input: StructuralInspectionInput) {
  const structure = await read.structure()
  const exports = await structure.exports({ path: input.path })
  const references = await structure.references({ target: { path: input.path, name: input.name } })
  const dependencies = await structure.dependencies()
  const direct = await structure.dependents({ path: input.module })
  const transitive = await structure.dependents({ path: input.module, transitive: true })
  // Retain the reader's evidence and uncertainty in the returned report. Empty
  // inventories acquire meaning from completeness, not from array length alone.
  return { exports, references, dependencies, direct, transitive }
}
