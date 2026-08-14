import type { Completeness, SourceSpan } from '../facts/index.ts'
import type { FactId, PolicyId } from '../identity/index.ts'
import type { AnalysisQuery } from '../query/index.ts'
import type { FactSchemaReference } from '../pass/index.ts'

export type PolicyRuleStatus = 'pass' | 'fail' | 'indeterminate' | 'error'

export interface PolicyManifest {
  readonly id: PolicyId
  readonly version: string
  readonly requiresCapabilities: readonly string[]
  /** Partial global capability may be evaluated only through rule-scoped completeness evidence. */
  readonly scopedCapabilities?: readonly string[]
  readonly inputs: readonly FactSchemaReference[]
  readonly rules: readonly string[]
  readonly limits: Readonly<Record<string, number | string | boolean>>
}

export interface PolicyDiagnostic {
  readonly code: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly message: string
  readonly rule: string
  readonly subject?: string
  readonly evidence: readonly SourceSpan[]
  readonly inputs: readonly FactId[]
}

export interface PolicyRuleResult {
  readonly rule: string
  readonly status: PolicyRuleStatus
  readonly diagnostics: readonly PolicyDiagnostic[]
  readonly matched: number
  readonly total: number
  /** Required for policies using scopedCapabilities; incomplete evidence must be indeterminate. */
  readonly evidenceCompleteness?: Completeness
}

export interface AnalysisPolicyContext {
  readonly query: AnalysisQuery
  capability(capability: string): Completeness | undefined
  readonly signal?: AbortSignal
}

export interface AnalysisPolicy {
  readonly manifest: PolicyManifest
  evaluate(context: AnalysisPolicyContext): Promise<readonly PolicyRuleResult[]>
}

export interface PolicyEvaluation {
  readonly generation: AnalysisQuery['generation']
  readonly policies: readonly {
    readonly policy: PolicyId
    readonly version: string
    readonly status: PolicyRuleStatus
    readonly rules: readonly PolicyRuleResult[]
  }[]
}

export interface PolicyRunOptions {
  readonly query: AnalysisQuery
  readonly policies: readonly AnalysisPolicy[]
  readonly signal?: AbortSignal
}
