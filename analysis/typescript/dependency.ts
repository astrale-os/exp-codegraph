import type { TypeScriptDependencyFact, TypeScriptDependencyOccurrence } from './model.ts'

import { deriveAnalysisId, type OccurrenceId } from '../identity/index.ts'
import { TYPESCRIPT_MODULE_FACT_NAMESPACE } from './model.ts'

export function typeScriptDependencyIdentity(
  input: Pick<
    TypeScriptDependencyFact,
    'sourceModule' | 'targetModule' | 'kind' | 'sourceFile' | 'targetFile'
  >,
): TypeScriptDependencyFact['id'] {
  return deriveAnalysisId('typescript-dependency', TYPESCRIPT_MODULE_FACT_NAMESPACE, input)
}

export function typeScriptDependencyOccurrenceIdentity(
  dependency: TypeScriptDependencyFact['id'],
  input: Omit<TypeScriptDependencyOccurrence, 'id'>,
): OccurrenceId {
  return deriveAnalysisId('occurrence', `${TYPESCRIPT_MODULE_FACT_NAMESPACE}:${dependency}`, {
    typeOnly: input.typeOnly,
    specifier: input.specifier,
    deep: input.deep,
    location: input.location,
    declaration: input.declaration ?? '',
    publicPath: input.publicPath ?? [],
  })
}
