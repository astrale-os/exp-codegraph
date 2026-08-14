import type ts from 'typescript'

import type { ObservationIssue } from '../../analysis/typescript/surface/model.ts'

/** Compiler-local project view used only while compiling authored declaration contracts. */
export interface DeclarationTypeScriptProject {
  readonly configFile: string
  readonly configurationFiles?: readonly string[]
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  readonly issues: readonly ObservationIssue[]
  readonly externalCoordinates?: ReadonlyMap<string, string>
}
