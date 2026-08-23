import type ts from 'typescript'

import { captureModuleTypeScriptEvidence, type ModuleTypeScriptEvidence } from './typescript-evidence.ts'
import { canonicalModuleTypeScriptPath as canonicalFile } from './typescript-reference.optimization.ts'

/**
 * Index immutable evidence once per Program source, then project exact owner closures without
 * repeatedly walking and resolving the same dependency source for every overlapping owner.
 */
export function createModuleTypeScriptEvidenceProjection(
  program: ts.Program,
  options: ts.CompilerOptions,
  observed?: ReadonlyMap<string, string | null>,
): (sources: readonly ts.SourceFile[]) => ModuleTypeScriptEvidence {
  const byFile = new Map(
    program.getSourceFiles().map((source) => [
      canonicalFile(source.fileName),
      captureModuleTypeScriptEvidence(program, options, [source], observed).sources[0]!,
    ] as const),
  )
  return (sources) => {
    const selected = sources.map((source) => byFile.get(canonicalFile(source.fileName))!)
    return { sources: selected }
  }
}
