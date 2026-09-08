import type ts from 'typescript';
import { type ModuleTypeScriptEvidence } from './typescript-evidence.ts';
/**
 * Index immutable evidence once per Program source, then project exact owner closures without
 * repeatedly walking and resolving the same dependency source for every overlapping owner.
 */
export declare function createModuleTypeScriptEvidenceProjection(program: ts.Program, options: ts.CompilerOptions, observed?: ReadonlyMap<string, string | null>): (sources: readonly ts.SourceFile[]) => ModuleTypeScriptEvidence;
