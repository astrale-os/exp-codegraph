import type { Diagnostic } from '../../source/diagnostic.ts'
import type { ModuleSourceReference } from '../resource/index.ts'

export interface ModuleTypeScriptAnalysis {
  readonly diagnostics: readonly Diagnostic[]
  readonly references: readonly ModuleSourceReference[]
}

export interface ModuleTypeScriptIsolationEntry {
  readonly key: string
  readonly analysis: ModuleTypeScriptAnalysis
}

export interface ModuleTypeScriptIsolationGroupResult {
  readonly entries: readonly ModuleTypeScriptIsolationEntry[]
  readonly programs: number
}
