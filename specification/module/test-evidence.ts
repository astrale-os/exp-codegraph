import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

import type { TestEvidenceReference } from '../../authoring/evidence.ts'
import type { Diagnostic } from '../../source/diagnostic.ts'
import type {
  LawResource,
  StateResource,
  TestEvidence,
  TestEvidenceStatus,
} from '../resource/index.ts'

import { readBounded, sourceRevision } from '../../source/file.ts'

interface ResolvedEvidence {
  readonly laws: readonly LawResource[]
  readonly states: readonly StateResource[]
  readonly diagnostics: readonly Diagnostic[]
}

interface ParsedTestFile {
  readonly source: string
  readonly text: string
  readonly revision: string
  readonly tests: readonly ParsedTest[]
}

interface ParsedTest {
  readonly id?: string
  readonly title: string
  readonly status: TestEvidenceStatus
  readonly line: number
  readonly column: number
  readonly code: string
}

interface EvidenceFailure {
  readonly code: string
  readonly message: string
}

/** Resolve exact Vitest test declarations without importing or executing test code. */
export async function resolveTestEvidence(
  root: string,
  moduleRoot: string,
  laws: readonly LawResource[],
  states: readonly StateResource[],
): Promise<ResolvedEvidence> {
  const diagnostics: Diagnostic[] = []
  const rootReal = await realpath(root)
  const cache = new Map<string, Promise<ParsedTestFile>>()

  const resolveReferences = async (
    references: readonly TestEvidenceReference[] | undefined,
    descriptorSource: string,
  ): Promise<readonly TestEvidence[]> => {
    const evidence: TestEvidence[] = []
    for (const reference of references ?? []) {
      try {
        evidence.push(await resolveReference(reference, root, rootReal, moduleRoot, cache))
      } catch (error) {
        const failure = asEvidenceFailure(error)
        diagnostics.push({
          code: failure.code,
          message: `${failure.message} (${reference.file}#${reference.id})`,
          file: descriptorSource,
          line: 1,
          column: 1,
        })
      }
    }
    return evidence
  }

  const resolvedLaws = await Promise.all(
    laws.map(
      async (resource): Promise<LawResource> => ({
        ...resource,
        definitions: await Promise.all(
          resource.definitions.map(async (definition) => ({
            ...definition,
            testEvidence: await resolveReferences(definition.tests, resource.source),
          })),
        ),
      }),
    ),
  )
  const resolvedStates = await Promise.all(
    states.map(
      async (resource): Promise<StateResource> => ({
        ...resource,
        definitions: await Promise.all(
          resource.definitions.map(async (definition) => ({
            ...definition,
            testEvidence: await resolveReferences(definition.tests, resource.source),
          })),
        ),
      }),
    ),
  )
  return { laws: resolvedLaws, states: resolvedStates, diagnostics }
}

async function resolveReference(
  reference: TestEvidenceReference,
  root: string,
  rootReal: string,
  moduleRoot: string,
  cache: Map<string, Promise<ParsedTestFile>>,
): Promise<TestEvidence> {
  const path = reference.file
  const id = reference.id
  if (isAbsolute(path)) {
    throw evidenceFailure(
      'TEST_EVIDENCE_PATH_INVALID',
      'Test evidence paths must be relative to the module root.',
    )
  }
  const absolute = resolve(moduleRoot, path)
  if (!within(root, absolute)) {
    throw evidenceFailure(
      'TEST_EVIDENCE_PATH_INVALID',
      'Test evidence must remain within the specification catalog root.',
    )
  }
  const source = portable(relative(root, absolute))
  const segments = source.split('/')
  if (!segments.some((segment) => segment === '__tests__' || segment === 'tests')) {
    throw evidenceFailure(
      'TEST_EVIDENCE_PATH_INVALID',
      'Test evidence must point into a tests or __tests__ directory.',
    )
  }
  if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(basename(absolute))) {
    throw evidenceFailure(
      'TEST_EVIDENCE_PATH_INVALID',
      'Test evidence must point to a .test or .spec JavaScript/TypeScript file.',
    )
  }

  const actual = await realpath(absolute).catch((error: unknown) => {
    throw evidenceFailure(
      'TEST_EVIDENCE_FILE_INVALID',
      error instanceof Error
        ? `Test evidence file cannot be read: ${error.message}`
        : String(error),
    )
  })
  if (!within(rootReal, actual)) {
    throw evidenceFailure(
      'TEST_EVIDENCE_PATH_INVALID',
      'Test evidence resolves outside the specification catalog root.',
    )
  }

  let parsed = cache.get(actual)
  if (!parsed) {
    parsed = parseTestFile(actual, source)
    cache.set(actual, parsed)
  }
  const file = await parsed
  const matches = file.tests.filter((test) => test.id === id)
  if (matches.length === 0) {
    throw evidenceFailure(
      'TEST_EVIDENCE_TEST_MISSING',
      `No statically declared it/test case has evidence id ${JSON.stringify(id)}.`,
    )
  }
  if (matches.length > 1) {
    throw evidenceFailure(
      'TEST_EVIDENCE_TEST_AMBIGUOUS',
      `More than one it/test case has evidence id ${JSON.stringify(id)}.`,
    )
  }
  const match = matches[0]!
  return {
    reference: `${reference.file}#${reference.id}`,
    id,
    source: file.source,
    title: match.title,
    status: match.status,
    line: match.line,
    column: match.column,
    code: match.code,
    revision: file.revision,
  }
}

async function parseTestFile(absolute: string, source: string): Promise<ParsedTestFile> {
  let text: string
  try {
    text = await readBounded(absolute)
  } catch (error) {
    throw evidenceFailure(
      'TEST_EVIDENCE_FILE_INVALID',
      error instanceof Error
        ? `Test evidence file cannot be read: ${error.message}`
        : String(error),
    )
  }
  const file = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, scriptKind(source))
  const parseDiagnostics = (
    file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics
  if (parseDiagnostics?.length) {
    throw evidenceFailure(
      'TEST_EVIDENCE_FILE_INVALID',
      `Test evidence file has invalid syntax: ${ts.flattenDiagnosticMessageText(parseDiagnostics[0]!.messageText, '\n')}`,
    )
  }
  const tests: ParsedTest[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const status = testCallStatus(node.expression)
      const title = node.arguments[0]
      if (
        status &&
        title &&
        (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))
      ) {
        const declaration = expressionStatement(node) ?? node
        const position = file.getLineAndCharacterOfPosition(node.getStart(file))
        tests.push({
          id: evidenceId(text, declaration, source, file),
          title: title.text,
          status,
          line: position.line + 1,
          column: position.character + 1,
          code: text.slice(declaration.getStart(file), declaration.getEnd()),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  const evidenceIds = tests.flatMap((test) => (test.id ? [test.id] : []))
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw evidenceFailure(
      'TEST_EVIDENCE_ID_AMBIGUOUS',
      'A test evidence id is declared more than once in the same file.',
    )
  }
  return { source, text, revision: sourceRevision(text), tests }
}

function evidenceId(
  text: string,
  declaration: ts.Node,
  source: string,
  file: ts.SourceFile,
): string | undefined {
  const comments = ts.getLeadingCommentRanges(text, declaration.getFullStart()) ?? []
  const values = comments.flatMap((comment) =>
    [...text.slice(comment.pos, comment.end).matchAll(/@evidence\s+([^\s*]+)/gu)].map(
      (match) => match[1]!,
    ),
  )
  if (values.length > 1) {
    throw evidenceFailure(
      'TEST_EVIDENCE_ID_INVALID',
      `A test declaration may carry only one @evidence id in ${source}.`,
    )
  }
  const id = values[0]
  if (id && !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u.test(id)) {
    const position = file.getLineAndCharacterOfPosition(declaration.getStart(file))
    throw evidenceFailure(
      'TEST_EVIDENCE_ID_INVALID',
      `Invalid @evidence id ${JSON.stringify(id)} at ${source}:${position.line + 1}.`,
    )
  }
  return id
}

function testCallStatus(expression: ts.Expression): TestEvidenceStatus | undefined {
  const modifiers: string[] = []
  let current = expression
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      modifiers.push(current.name.text)
      current = current.expression
      continue
    }
    if (ts.isCallExpression(current)) {
      current = current.expression
      continue
    }
    if (ts.isTaggedTemplateExpression(current)) {
      current = current.tag
      continue
    }
    break
  }
  if (!ts.isIdentifier(current) || (current.text !== 'it' && current.text !== 'test')) return
  if (modifiers.includes('todo')) return 'todo'
  if (modifiers.includes('skip')) return 'skipped'
  return 'active'
}

function expressionStatement(node: ts.Node): ts.ExpressionStatement | undefined {
  let current: ts.Node | undefined = node
  while (current && !ts.isSourceFile(current)) {
    if (ts.isExpressionStatement(current)) return current
    current = current.parent
  }
  return
}

function scriptKind(source: string): ts.ScriptKind {
  if (/\.tsx$/i.test(source)) return ts.ScriptKind.TSX
  if (/\.jsx$/i.test(source)) return ts.ScriptKind.JSX
  if (/\.[cm]?js$/i.test(source)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function within(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function portable(value: string): string {
  return value.split(sep).join('/')
}

function evidenceFailure(code: string, message: string): EvidenceFailure {
  return { code, message }
}

function asEvidenceFailure(error: unknown): EvidenceFailure {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  ) {
    return error as EvidenceFailure
  }
  return {
    code: 'TEST_EVIDENCE_FILE_INVALID',
    message: error instanceof Error ? error.message : String(error),
  }
}
