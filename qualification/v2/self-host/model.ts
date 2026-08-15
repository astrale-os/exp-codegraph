export const SELF_HOST_AUDIT_FORMAT = 'astrale.codegraph.self-host-audit' as const
export const SELF_HOST_EVIDENCE_FORMAT = 'astrale.codegraph.self-host-qualification' as const

export type SelfHostTargetId = 'codegraph' | 'kernel'

export interface SelfHostTarget {
  readonly id: SelfHostTargetId
  readonly repository: string
  readonly root: string
  readonly excludeSpecifications?: readonly string[]
}

export interface SelfHostAuditDisposition {
  readonly fingerprint: string
  readonly status: 'accepted'
  readonly rationale: string
  readonly witnesses: readonly string[]
}

export interface SelfHostAudit {
  readonly format: typeof SELF_HOST_AUDIT_FORMAT
  readonly version: 1
  readonly dispositions: readonly SelfHostAuditDisposition[]
}

export type SelfHostCandidateKind =
  | 'compiler-diagnostic'
  | 'incomplete-capability'
  | 'incomplete-fact'
  | 'large-fact'

export interface SelfHostCandidate {
  readonly fingerprint: string
  readonly target: SelfHostTargetId
  readonly project: string
  readonly kind: SelfHostCandidateKind
  readonly summary: string
  readonly count: number
  readonly witnesses: readonly string[]
  readonly disposition: 'unresolved' | 'accepted' | 'fix-required'
  readonly rationale?: string
}

export interface SelfHostFactSummary {
  readonly semanticDigest: string
  readonly boundFactDigest: string
  readonly manifestDigest: string
  readonly facts: number
  readonly factBytes: number
  readonly namespaces: Readonly<Record<string, number>>
  readonly namespaceBytes: Readonly<Record<string, number>>
  readonly namespaceDigests: Readonly<Record<string, string>>
  readonly kinds: Readonly<Record<string, number>>
  /** Additive serialized members of the TypeScript body payload and nested IR object. */
  readonly bodyFieldBytes: Readonly<Record<string, number>>
  /** Nested diagnostic attribution; these values are already included in `bodyFieldBytes.occurrences`. */
  readonly bodyOccurrenceFieldBytes: Readonly<Record<string, number>>
  readonly valueStates: Readonly<Record<'known' | 'unknown' | 'ambiguous' | 'unsupported', number>>
  readonly calls: number
  readonly capabilities: Readonly<Record<string, string>>
  readonly compilerDiagnostics: number
  readonly largestFacts: readonly {
    readonly bytes: number
    readonly namespace: string
    readonly kind: string
    readonly subject: string
    readonly sources: readonly string[]
  }[]
  readonly candidateInputs: readonly Omit<SelfHostCandidate, 'disposition' | 'rationale'>[]
}

export interface SelfHostProjectResult {
  readonly project: string
  readonly modules: number
  readonly generation: string
  readonly universe: string
  readonly coldMemoryMs: number
  readonly warmMemoryMs: number
  readonly coldSQLiteMs: number
  readonly warmReusedGeneration: boolean
  readonly memoryEqualsSQLite: boolean
  readonly sqliteReopenEquivalent: boolean
  readonly summary: SelfHostFactSummary
}

export interface SelfHostTargetResult {
  readonly target: SelfHostTargetId
  readonly repository: string
  readonly specifications: number
  readonly boundaries: number
  readonly corpus: {
    readonly specificationSources: readonly string[]
    readonly moduleIds: readonly string[]
    readonly projectIds: readonly string[]
    readonly unboundModuleIds: readonly string[]
    readonly digest: string
  }
  readonly inventory: {
    readonly revision: string
    readonly files: number
    readonly stableDuringRun: boolean
  }
  readonly snapshotSet: {
    readonly id: string
    readonly inventory: string
    readonly universes: readonly string[]
    readonly memoryEqualsSQLite: boolean
  }
  readonly incremental: {
    readonly project: string
    readonly changed: string
    readonly incrementalMs: number
    readonly coldRebuildMs: number
    readonly coldSQLiteMs: number
    readonly generation: string
    readonly semanticDigest: string
    readonly incrementalEqualsCold: boolean
    readonly incrementalEqualsSQLite: boolean
  }
  readonly projects: readonly SelfHostProjectResult[]
  readonly sqliteBytes: number
  readonly candidates: readonly SelfHostCandidate[]
}
