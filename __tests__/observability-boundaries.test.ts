import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const boundaryFiles = [
  'analysis/protocol/process-session.ts',
  'application/checkpoint/checkpoint.ts',
  'application/node/source-proof.ts',
  'cli/semantic-pack/store.ts',
  'compiler/cache.ts',
  'compiler/coalesce.ts',
  'compiler/isolate.ts',
  'compiler/isolation.optimization.ts',
  'compiler/worker.ts',
  'workspace/checkpoint/store.ts',
  'workspace/checkpoint/store.optimization.ts',
] as const

describe('performance-boundary observability', () => {
  it('rejects empty, unexplained, or error-erasing catches at governed boundaries', async () => {
    const violations: string[] = []
    for (const file of boundaryFiles) {
      const source = await readFile(resolve(root, file), 'utf8')
      const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      visit(syntax, (clause) => {
        const body = source.slice(clause.block.getStart(syntax), clause.block.end)
        const line = syntax.getLineAndCharacterOfPosition(clause.getStart(syntax)).line + 1
        const variable = clause.variableDeclaration?.name.getText(syntax)
        const rationale = /advisory|another writer|cache miss|concurrent|diagnostic|fallback|fsync|uncertainty/iu
          .test(body)
        if (!clause.block.statements.length && !rationale) {
          violations.push(`${file}:${line} empty catch`)
        }
        if (variable && !new RegExp(`\\b${escapeRegExp(variable)}\\b`, 'u').test(body) && !rationale) {
          violations.push(`${file}:${line} erases ${variable}`)
        }
        if (!variable && !containsExit(clause.block) && !rationale) {
          violations.push(`${file}:${line} has no attributable fallback or rationale`)
        }
      })
    }
    expect(violations).toEqual([])
  })

  it('retains stable failure families and attributable performance fallback vocabulary', async () => {
    const required: Readonly<Record<(typeof boundaryFiles)[number], readonly string[]>> = {
      'analysis/protocol/process-session.ts': [
        'NATIVE_ANALYSIS_RESIDENT_LIMIT',
        'configured decoded semantic payload limit',
        'configured transaction limit',
        'invalid protocol frame',
      ],
      'application/checkpoint/checkpoint.ts': ['incompatible', 'corrupt', 'unavailable'],
      'application/node/source-proof.ts': [
        'proof-unstable',
        'proof-unreadable',
        'proof-unsupported',
      ],
      'cli/semantic-pack/store.ts': ['publication-failed', 'load-failed', 'identity-mismatch'],
      'compiler/cache.ts': ['cache miss'],
      'compiler/coalesce.ts': ['API_BATCH_COMPILE_FAILED'],
      'compiler/isolate.ts': [
        'isolation/timeout',
        'isolation/output-limit',
        'isolation/protocol-error',
        'isolation/worker-error',
      ],
      'compiler/isolation.optimization.ts': ['fallback'],
      'compiler/worker.ts': ['isolation/request-invalid'],
      'workspace/checkpoint/store.ts': [
        'manifest-unreadable',
        'artifact-corrupt',
        'Advisory cleanup',
      ],
      'workspace/checkpoint/store.optimization.ts': ['failure'],
    }
    for (const [file, tokens] of Object.entries(required)) {
      const source = await readFile(resolve(root, file), 'utf8')
      for (const token of tokens) expect(source, `${file} lacks ${token}`).toContain(token)
    }
  })
})

function visit(node: ts.Node, accept: (clause: ts.CatchClause) => void): void {
  if (ts.isCatchClause(node)) accept(node)
  node.forEachChild((child) => visit(child, accept))
}

function containsExit(node: ts.Node): boolean {
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true
  let exit = false
  node.forEachChild((child) => {
    if (!exit) exit = containsExit(child)
  })
  return exit
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
