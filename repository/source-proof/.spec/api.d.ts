export type SourceProofId = `source-proof:${string}`

export interface SourceScope {
  readonly version: string
  readonly exclude: readonly string[]
  readonly ignored: 'reject-semantic'
}

export type SourceProofOverlayEntry =
  | {
      readonly path: string
      readonly kind: 'content'
      readonly content: 'file' | 'symlink'
      readonly mode: '100644' | '100755' | '120000'
      readonly bytes: number
      readonly digest: string
    }
  | {
      readonly path: string
      readonly kind: 'deletion'
      readonly previousMode: string
    }

export interface SourceProof {
  readonly format: 'astrale.codegraph.source-proof'
  readonly version: 1
  readonly id: SourceProofId
  readonly repositoryFormat: string
  readonly objectFormat: string
  readonly headTree: string
  /** Exact relative directory topology retained because Git omits empty directories. */
  readonly topologyDigest: string
  readonly scope: SourceScope
  readonly overlay: readonly SourceProofOverlayEntry[]
  readonly changedPaths: readonly string[]
}

export type SourceProofFallbackCode =
  | 'proof-unsupported'
  | 'proof-unstable'
  | 'proof-conflict'
  | 'proof-unreadable'

export type SourceProofAdmission =
  | { readonly ok: true; readonly proof: SourceProof }
  | {
      readonly ok: false
      readonly code: SourceProofFallbackCode
      readonly message: string
      readonly retryable: boolean
    }

export interface SourceProofProvider {
  admit(root: string, scope: SourceScope, signal?: AbortSignal): Promise<SourceProofAdmission>
}

export function createSourceProof(input: Omit<SourceProof, 'id'>): SourceProof
