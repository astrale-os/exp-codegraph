import ts from 'typescript'

import { operationSnapshot, operationSnapshotNamespace } from '../../source/operation-snapshot.ts'

export interface AuthoringSyntaxAnalysis {
  readonly file: ts.SourceFile
  readonly diagnostics: readonly ts.Diagnostic[]
}

interface AuthoringSyntaxSource extends AuthoringSyntaxAnalysis {
  readonly text: string
}

const authoringSources = operationSnapshotNamespace<AuthoringSyntaxSource>(
  'specification-authoring-syntax-sources',
)

/** Retain immutable source ASTs already parsed by the shared module compiler universe. */
export function markAuthoringSyntaxSources(
  sources: readonly { readonly source: string; readonly file: ts.SourceFile }[],
): void {
  const values = operationSnapshot(authoringSources)
  if (!values) return
  for (const source of sources) {
    const current = values.get(source.source)
    if (current && current.text !== source.file.text) {
      throw new Error(`Authoring source changed during compilation: ${source.source}`)
    }
    const diagnostics = (
      source.file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
    ).parseDiagnostics ?? []
    values.set(source.source, { text: source.file.text, file: source.file, diagnostics })
  }
}

/** Reuse or create one exact standalone syntax analysis inside the coherent operation. */
export function operationAuthoringSyntaxAnalysis(
  source: string,
  text: string,
  create: () => AuthoringSyntaxAnalysis,
): AuthoringSyntaxAnalysis | undefined {
  const values = operationSnapshot(authoringSources)
  if (!values) return
  const current = values.get(source)
  if (current) {
    if (current.text !== text) {
      throw new Error(`Authoring source changed during compilation: ${source}`)
    }
    return current
  }
  const created = create()
  values.set(source, { text, ...created })
  return created
}
