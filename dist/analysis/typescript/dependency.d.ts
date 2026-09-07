import type { TypeScriptDependencyFact, TypeScriptDependencyOccurrence } from './model.ts';
import { type OccurrenceId } from '../identity/index.ts';
export declare function typeScriptDependencyIdentity(input: Pick<TypeScriptDependencyFact, 'sourceModule' | 'targetModule' | 'kind' | 'sourceFile' | 'targetFile'>): TypeScriptDependencyFact['id'];
export declare function typeScriptDependencyOccurrenceIdentity(dependency: TypeScriptDependencyFact['id'], input: Omit<TypeScriptDependencyOccurrence, 'id'>): OccurrenceId;
