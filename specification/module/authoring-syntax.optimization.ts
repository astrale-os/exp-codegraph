import ts from 'typescript'

import { operationSnapshot, operationSnapshotNamespace } from '../../source/operation-snapshot.ts'

interface AuthoringSyntaxSource {
  readonly text: string
  readonly file: ts.SourceFile
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
    values.set(source.source, { text: source.file.text, file: source.file })
  }
}

/** Return the exact operation-owned AST only while its admitted text still matches. */
export function operationAuthoringSyntaxSource(
  source: string,
  text: string,
): ts.SourceFile | undefined {
  const current = operationSnapshot(authoringSources)?.get(source)
  return current?.text === text ? current.file : undefined
}
