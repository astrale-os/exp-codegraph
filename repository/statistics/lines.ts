import ts from 'typescript'

import type {
  RepositorySourceLineAnalyzer,
  RepositorySourceLineInput,
  SourceLineMetrics,
} from './model.ts'

/** Exact scanner-backed line classification for the TypeScript/JavaScript language family. */
export function createTypeScriptSourceLineAnalyzer(): RepositorySourceLineAnalyzer {
  return {
    id: 'astrale.repository.lines.typescript',
    version: '1.0.0',
    supports: ({ language }) => language === 'typescript' || language === 'javascript',
    analyze(input) {
      const source = ts.createSourceFile(
        input.path,
        input.text,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(input.path),
      )
      return typeScriptSourceLines(source)
    },
  }
}

/**
 * Conservative fallback for text formats without a registered language adapter.
 * Physical and blank lines remain exact; non-blank content remains explicitly unclassified.
 */
export function createTextSourceLineAnalyzer(): RepositorySourceLineAnalyzer {
  return {
    id: 'astrale.repository.lines.text',
    version: '1.0.0',
    supports: () => true,
    analyze: ({ text }) => textSourceLines(text),
  }
}

export function defaultRepositorySourceLineAnalyzers(): readonly RepositorySourceLineAnalyzer[] {
  return [createTypeScriptSourceLineAnalyzer(), createTextSourceLineAnalyzer()]
}

/** Classify physical source lines through the TypeScript scanner, never text heuristics. */
export function typeScriptSourceLines(source: ts.SourceFile): SourceLineMetrics {
  const physical = physicalSourceLines(source.text)
  if (!physical) return emptySourceLines()

  const code = new Set<number>()
  const comments = new Set<number>()
  const scanner = ts.createScanner(
    source.languageVersion,
    false,
    source.languageVariant,
    source.text,
  )
  while (true) {
    const kind = scanner.scan()
    if (kind === ts.SyntaxKind.EndOfFileToken) break
    if (ignoredTrivia(kind)) continue
    const start = scanner.getTokenPos()
    const end = Math.max(start, scanner.getTextPos() - 1)
    const first = source.getLineAndCharacterOfPosition(start).line
    const last = source.getLineAndCharacterOfPosition(end).line
    const target = commentTrivia(kind) ? comments : code
    for (let line = first; line <= last && line < physical; line += 1) target.add(line)
  }
  for (const line of code) comments.delete(line)
  return {
    physical,
    code: code.size,
    comment: comments.size,
    blank: Math.max(0, physical - code.size - comments.size),
    unclassified: 0,
  }
}

export function textSourceLines(text: string): SourceLineMetrics {
  const physical = physicalSourceLines(text)
  if (!physical) return emptySourceLines()
  const lines = splitPhysicalLines(text)
  const blank = lines.filter((line) => !line.trim()).length
  return {
    physical,
    code: 0,
    comment: 0,
    blank,
    unclassified: physical - blank,
  }
}

export function physicalSourceLines(text: string): number {
  if (!text.length) return 0
  const breaks = text.match(/\r\n|\r|\n/g)?.length ?? 0
  return breaks + (/\r\n$|\r$|\n$/.test(text) ? 0 : 1)
}

export function emptySourceLines(): SourceLineMetrics {
  return { physical: 0, code: 0, comment: 0, blank: 0, unclassified: 0 }
}

function splitPhysicalLines(text: string): readonly string[] {
  if (!text.length) return []
  const lines = text.split(/\r\n|\r|\n/u)
  if (/\r\n$|\r$|\n$/.test(text)) lines.pop()
  return lines
}

function scriptKind(path: string): ts.ScriptKind {
  const normalized = path.toLowerCase()
  if (normalized.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (normalized.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function commentTrivia(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia
  )
}

function ignoredTrivia(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.WhitespaceTrivia ||
    kind === ts.SyntaxKind.NewLineTrivia ||
    kind === ts.SyntaxKind.ConflictMarkerTrivia
  )
}

export function analyzeSourceLines(
  input: RepositorySourceLineInput,
  analyzers: readonly RepositorySourceLineAnalyzer[] = defaultRepositorySourceLineAnalyzers(),
): { readonly metrics: SourceLineMetrics; readonly analyzer: RepositorySourceLineAnalyzer } {
  const analyzer = analyzers.find((candidate) => candidate.supports(input))
  if (!analyzer) {
    throw new Error(`No source-line analyzer supports ${input.language}:${input.path}.`)
  }
  return { metrics: analyzer.analyze(input), analyzer }
}
