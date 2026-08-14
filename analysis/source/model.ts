import type { SourceId, SourceRevisionId } from '../identity/index.ts'

export interface SourceTextExpectation {
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly logicalPath: string
  readonly textDigest: string
}

export interface SourceTextReader {
  read(path: string, options?: { readonly signal?: AbortSignal }): Promise<string>
}

export type VerifiedSourceText =
  | {
      readonly kind: 'verified'
      readonly source: SourceId
      readonly revision: SourceRevisionId
      readonly logicalPath: string
      readonly textDigest: string
      readonly text: string
    }
  | {
      readonly kind: 'stale'
      readonly source: SourceId
      readonly revision: SourceRevisionId
      readonly logicalPath: string
      readonly expectedDigest: string
      readonly actualDigest: string
      readonly actualRevision: SourceRevisionId
    }
  | {
      readonly kind: 'unavailable'
      readonly source: SourceId
      readonly revision: SourceRevisionId
      readonly logicalPath: string
      readonly code: 'SOURCE_TEXT_UNAVAILABLE'
      readonly message: string
    }
