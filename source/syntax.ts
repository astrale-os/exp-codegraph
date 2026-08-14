import type { LRLanguage } from '@codemirror/language'

import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from '@codemirror/lang-javascript'
import { yamlLanguage } from '@codemirror/lang-yaml'
import { classHighlighter, highlightCode } from '@lezer/highlight'

export interface SourceSyntaxToken {
  readonly text: string
  readonly classes?: string
}

export interface HighlightedSourceCode {
  readonly language: string
  readonly tokens: readonly SourceSyntaxToken[]
}

interface SourceLanguage {
  readonly name: string
  readonly parser: LRLanguage['parser']
}

const TYPESCRIPT = language('typescript', typescriptLanguage)
const TSX = language('tsx', tsxLanguage)
const JAVASCRIPT = language('javascript', javascriptLanguage)
const JSX = language('jsx', jsxLanguage)
const JSON_LANGUAGE = language('json', javascriptLanguage)
const YAML = language('yaml', yamlLanguage)

const declaredLanguages = new Map<string, SourceLanguage>([
  ...aliases(TYPESCRIPT, ['ts', 'typescript', 'mts', 'cts', 'dts']),
  ...aliases(TSX, ['tsx']),
  ...aliases(JAVASCRIPT, ['js', 'javascript', 'mjs', 'cjs', 'node']),
  ...aliases(JSX, ['jsx']),
  ...aliases(JSON_LANGUAGE, ['json', 'jsonc']),
  ...aliases(YAML, ['yaml', 'yml']),
])

const plainLanguages = new Set(['text', 'txt', 'plain', 'plaintext', 'none'])

/** Highlight an explicitly supported language or conservatively infer an unlabeled block. */
export function highlightSourceCode(
  code: string,
  declaredLanguage?: string | null,
): HighlightedSourceCode | undefined {
  if (!code) return
  const declared = normalizeLanguage(declaredLanguage)
  if (declared && plainLanguages.has(declared)) return
  const selected = declared ? declaredLanguages.get(declared) : detectLanguage(code)
  // An explicit but unsupported language is authoritative and must not be guessed differently.
  if (!selected) return

  try {
    const tokens: SourceSyntaxToken[] = []
    highlightCode(
      code,
      selected.parser.parse(code),
      classHighlighter,
      (text, classes) => tokens.push(classes ? { text, classes } : { text }),
      () => tokens.push({ text: '\n' }),
    )
    return { language: selected.name, tokens }
  } catch {
    // Syntax coloring must never make otherwise valid source unrenderable.
    return
  }
}

/** Map a file-backed source resource to the same language aliases accepted by code fences. */
export function sourceLanguage(source: string): string | undefined {
  const name = source.toLowerCase().split(/[?#]/, 1)[0] ?? ''
  if (name.endsWith('.tsx')) return 'tsx'
  if (/\.(?:ts|mts|cts)$/.test(name)) return 'typescript'
  if (name.endsWith('.jsx')) return 'jsx'
  if (/\.(?:js|mjs|cjs)$/.test(name)) return 'javascript'
  if (/\.jsonc?$/.test(name)) return 'json'
  if (/\.ya?ml$/.test(name)) return 'yaml'
  return
}

/** Serialize trusted parser tokens while escaping every source character. */
export function highlightedSourceHtml(source: HighlightedSourceCode): string {
  return source.tokens
    .map(({ text, classes }) => {
      const encoded = escapeHtml(text)
      return classes ? `<span class="${classes}">${encoded}</span>` : encoded
    })
    .join('')
}

function detectLanguage(code: string): SourceLanguage | undefined {
  const value = code.trim()
  if (!value) return

  if (looksLikeTypeScript(value)) return TYPESCRIPT
  if (looksLikeJson(value)) return JSON_LANGUAGE
  if (looksLikeJavaScript(value)) return JAVASCRIPT
  if (looksLikeYaml(value)) return YAML
  return
}

function looksLikeTypeScript(code: string): boolean {
  return (
    /(^|\n)\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|type|enum|namespace)\s+[A-Za-z_$]/m.test(
      code,
    ) ||
    /\b(?:implements|keyof|satisfies|infer|readonly)\b/.test(code) ||
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*[^:=]/.test(code) ||
    /\([^\n)]*\b[A-Za-z_$][\w$]*\??\s*:\s*[^)\n]+\)/.test(code) ||
    /\)\s*:\s*[A-Za-z_$<{[(]/.test(code) ||
    /\bas\s+(?:const|[A-Z][\w$]*)\b/.test(code) ||
    (/[{}]/.test(code) && /(^|\n)\s*[A-Za-z_$][\w$]*\??\s*:\s*\S/m.test(code))
  )
}

function looksLikeJson(code: string): boolean {
  if (!/^[{[]/.test(code)) return false
  try {
    JSON.parse(code)
    return true
  } catch {
    return false
  }
}

function looksLikeJavaScript(code: string): boolean {
  return (
    /(^|\n)\s*(?:import|export)\s/m.test(code) ||
    (/\b(?:const|let|var|function|class|async|await|return|throw|new)\b/.test(code) &&
      /[{}();=]/.test(code))
  )
}

function looksLikeYaml(code: string): boolean {
  if (/[{};]/.test(code)) return false
  const mappings = code
    .split('\n')
    .filter((line) => /^\s*(?:-\s+)?[A-Za-z_][\w.-]*\s*:\s*(?:\S.*)?$/.test(line)).length
  return mappings >= 2 || (mappings === 1 && /(^|\n)\s*-\s+/.test(code))
}

function normalizeLanguage(value: string | null | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/^language-/, '')
    .replace(/^\{\./, '')
    .replace(/\}$/, '')
  return normalized || undefined
}

function language(name: string, value: LRLanguage): SourceLanguage {
  return { name, parser: value.parser }
}

function aliases(
  value: SourceLanguage,
  names: readonly string[],
): Array<readonly [string, SourceLanguage]> {
  return names.map((name) => [name, value] as const)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
