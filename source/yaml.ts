import { LineCounter, parseDocument, type Document } from 'yaml'

import { pointerFromPath, pointerSegments } from '../reference/pointer.ts'
import { errorDiagnostic, type Diagnostic } from './diagnostic.ts'
import { readBounded } from './file.ts'
import { MAX_VALUE_DEPTH, MAX_VALUE_NODES } from './limits.ts'

const MAX_ALIASES = 100

interface Budget {
  nodes: number
  exceeded: boolean
}

export interface YamlSource {
  text: string
  data: unknown
  diagnostics: Diagnostic[]
  document?: Document
  lines?: LineCounter
}

export async function loadYaml(file: string, source: string): Promise<YamlSource> {
  let text = ''
  const diagnostics: Diagnostic[] = []
  let data: unknown = null
  let document: Document | undefined
  let lines: LineCounter | undefined

  try {
    text = await readBounded(file)
    lines = new LineCounter()
    document = parseDocument(text, {
      intAsBigInt: true,
      lineCounter: lines,
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
      version: '1.2',
    })
    for (const issue of [...document.errors, ...document.warnings]) {
      const position = issue.linePos?.[0] ?? lines.linePos(issue.pos[0] ?? 0)
      diagnostics.push({
        code: 'YAML_INVALID',
        message: issue.message,
        file: source,
        line: position.line,
        column: position.col,
      })
    }
    if (!diagnostics.length) {
      const value = document.toJS({ mapAsMap: true, maxAliasCount: MAX_ALIASES })
      data = jsonValue(value, [], diagnostics, source, document, lines, new Set(), {
        nodes: 0,
        exceeded: false,
      })
    }
  } catch (error) {
    diagnostics.push(errorDiagnostic('YAML_INVALID', error, source))
  }

  return { text, data, diagnostics, document, lines }
}

export function sourcePosition(
  document: Document,
  lines: LineCounter,
  pointer: string,
): { line: number; column: number } {
  const segments = pointerSegments(pointer)
  let node: unknown
  for (let length = segments.length; length >= 0; length--) {
    node = document.getIn(segments.slice(0, length), true)
    if (node && typeof node === 'object' && 'range' in node) break
  }
  const range =
    node && typeof node === 'object' && 'range' in node
      ? (node as { range?: [number] }).range
      : undefined
  const position = lines.linePos(range?.[0] ?? 0)
  return { line: position.line, column: position.col }
}

function jsonValue(
  value: unknown,
  path: (string | number)[],
  diagnostics: Diagnostic[],
  file: string,
  document: Document,
  lines: LineCounter,
  ancestors: Set<object>,
  budget: Budget,
): unknown {
  if (budget.nodes >= MAX_VALUE_NODES) {
    if (!budget.exceeded) {
      budget.exceeded = true
      diagnose('YAML_SIZE', `Values may contain at most ${MAX_VALUE_NODES} nodes.`, path)
    }
    return null
  }
  budget.nodes++

  if (path.length > MAX_VALUE_DEPTH) {
    diagnose('YAML_DEPTH', `Values may be nested at most ${MAX_VALUE_DEPTH} levels.`, path)
    return null
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    diagnose('YAML_NON_JSON', 'Numbers must be finite.', path)
    return null
  }
  if (typeof value === 'bigint') {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value)
    }
    diagnose('YAML_NON_JSON', 'Integers must be exactly representable as JSON numbers.', path)
    return null
  }
  if (!value || typeof value !== 'object') {
    diagnose('YAML_NON_JSON', 'Value is not representable as JSON.', path)
    return null
  }
  if (ancestors.has(value)) {
    diagnose('YAML_CYCLE', 'Cyclic aliases are not supported.', path)
    return null
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = []
      for (let index = 0; index < value.length; index++) {
        const item = jsonValue(
          value[index],
          [...path, index],
          diagnostics,
          file,
          document,
          lines,
          ancestors,
          budget,
        )
        if (budget.exceeded) break
        result.push(item)
      }
      return result
    }
    if (value instanceof Map) {
      const object: Record<string, unknown> = Object.create(null)
      for (const [key, item] of value) {
        if (typeof key !== 'string') {
          diagnose('YAML_NON_STRING_KEY', 'Mapping keys must be strings.', path)
          continue
        }
        const child = jsonValue(
          item,
          [...path, key],
          diagnostics,
          file,
          document,
          lines,
          ancestors,
          budget,
        )
        if (budget.exceeded) break
        Object.defineProperty(object, key, {
          value: child,
          enumerable: true,
          configurable: true,
          writable: true,
        })
      }
      return object
    }
    diagnose('YAML_NON_JSON', 'Value is not representable as JSON.', path)
    return null
  } finally {
    ancestors.delete(value)
  }

  function diagnose(code: string, message: string, target: (string | number)[]): void {
    const pointer = pointerFromPath(target)
    diagnostics.push({ code, message, file, pointer, ...sourcePosition(document, lines, pointer) })
  }
}
