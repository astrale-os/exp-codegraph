import { javascript } from '@codemirror/lang-javascript'
import { foldGutter, foldKeymap } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view'
import { useEffect, useRef } from 'preact/hooks'

import type { ApiModel, ApiSource, ApiToken } from '../../api/model.ts'

import { semanticSyntaxHighlighting } from '../source/highlight.ts'
import { editorTheme } from '../source/theme.ts'

interface DeclarationEditorProps {
  api?: ApiModel
  source: ApiSource
  focusOffset?: number
  onNavigate(identity: string, intent: DeclarationNavigationIntent): void
}

export type DeclarationNavigationIntent = 'peek' | 'open-definition'

export interface DeclarationClickNavigation {
  readonly identity: string
  readonly intent: DeclarationNavigationIntent
}

export function DeclarationEditor({
  api,
  source,
  focusOffset,
  onNavigate,
}: DeclarationEditorProps) {
  const text = source.text
  if (text === undefined) {
    throw new Error(`Declaration editor requires navigation source text: ${source.file}`)
  }
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const navigate = useRef(onNavigate)
  navigate.current = onNavigate

  useEffect(() => {
    if (!host.current) return
    const tokens = api?.tokens.filter((token) => token.file === source.file) ?? []
    const throws = detectedThrowReferences(
      text,
      Object.values(api?.metadata ?? {}).flatMap((metadata) => metadata.errors),
    )
    const decorations = tokenDecorations(tokens, api)
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          foldGutter({ openText: '⌄', closedText: '›' }),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          javascript({ typescript: true }),
          semanticSyntaxHighlighting,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          EditorView.decorations.of(decorations),
          EditorView.decorations.of(throwDecorations(throws)),
          EditorView.decorations.of(unknownPlaceholderDecorations(text)),
          EditorView.contentAttributes.of({
            'aria-label': `${source.file} declaration source`,
            spellcheck: 'false',
          }),
          EditorView.domEventHandlers({
            click(event) {
              const element = (event.target as HTMLElement).closest<HTMLElement>(
                '[data-api-target], [data-api-declaration]',
              )
              const action = declarationClickNavigation(
                element?.dataset.apiTarget,
                element?.dataset.apiDeclaration,
                event.metaKey || event.ctrlKey,
              )
              if (!action) return false
              navigate.current(action.identity, action.intent)
              return true
            },
          }),
          hoverTooltip((_editorView, position) => tooltipAt(api, source.file, position, throws)),
          keymap.of([
            ...foldKeymap,
            {
              key: 'Mod-Enter',
              run(editorView) {
                const token = tokenAt(tokens, editorView.state.selection.main.head)
                const target = token?.target
                if (!target) return false
                navigate.current(target, 'open-definition')
                return true
              },
            },
          ]),
          editorTheme,
          apiDeclarationTheme,
        ],
      }),
    })
    view.current = editor
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => editor.requestMeasure())
    observer?.observe(host.current)
    editor.requestMeasure()
    return () => {
      observer?.disconnect()
      editor.destroy()
      view.current = null
    }
  }, [api, source.file, source.text])

  useEffect(() => {
    const editor = view.current
    if (!editor || focusOffset === undefined) return
    const offset = Math.min(focusOffset, editor.state.doc.length)
    editor.dispatch({
      selection: { anchor: offset },
      effects: EditorView.scrollIntoView(offset, { y: 'center' }),
    })
  }, [focusOffset, source.file])

  return (
    <div
      class={`api-declaration-editor${focusOffset === undefined ? '' : ' has-line-selection'}`}
      ref={host}
    />
  )
}

export function declarationClickNavigation(
  target: string | undefined,
  declaration: string | undefined,
  modified: boolean,
): DeclarationClickNavigation | undefined {
  if (modified) {
    const identity = target ?? declaration
    return identity ? { identity, intent: 'open-definition' } : undefined
  }
  return target ? { identity: target, intent: 'peek' } : undefined
}

interface PresentationRange {
  readonly from: number
  readonly to: number
}

export interface DetectedThrowReference extends PresentationRange {
  readonly code: string
}

export function detectedThrowReferences(
  text: string,
  detectedErrors: readonly string[],
): DetectedThrowReference[] {
  const detected = new Set(detectedErrors)
  if (!detected.size) return []
  const references: DetectedThrowReference[] = []
  for (const tag of text.matchAll(/@throws\b([^\r\n]*)/g)) {
    const body = tag[1]
    if (tag.index === undefined || body === undefined) continue
    const bodyStart = tag.index + tag[0].length - body.length
    for (const token of body.matchAll(/[A-Za-z_$][\w$.-]*/g)) {
      const code = token[0]
      if (token.index === undefined || !detected.has(code)) continue
      const from = bodyStart + token.index
      references.push({ code, from, to: from + code.length })
    }
  }
  return references
}

function throwDecorations(references: readonly DetectedThrowReference[]): DecorationSet {
  return Decoration.set(
    references.map(({ code, from, to }) =>
      Decoration.mark({
        class: 'api-throws-reference',
        attributes: { 'data-api-error': code },
      }).range(from, to),
    ),
    true,
  )
}

function unknownPlaceholderDecorations(text: string): DecorationSet {
  return Decoration.set(
    unknownPlaceholderRanges(text).map(({ from, to }) => Decoration.replace({}).range(from, to)),
    true,
  )
}

export function unknownPlaceholderRanges(text: string): PresentationRange[] {
  const ranges: PresentationRange[] = []
  collectHiddenRanges(
    text,
    /^([ \t]*(?:(?:export|declare|default|async)\s+)*function\b[^\n]*\)\s*)(:\s*unknown\s*;?)(?=[ \t]*$)/gm,
    ranges,
  )
  collectHiddenRanges(
    text,
    /^([ \t]*(?:(?:export|declare)\s+)*type\s+[A-Za-z_$][\w$]*(?:\s*<[^>\n]*>)?)(\s*=\s*unknown\s*;?)(?=[ \t]*$)/gm,
    ranges,
  )
  return ranges.sort((left, right) => left.from - right.from)
}

function collectHiddenRanges(text: string, pattern: RegExp, ranges: PresentationRange[]): void {
  for (const match of text.matchAll(pattern)) {
    const prefix = match[1]
    const hidden = match[2]
    if (match.index === undefined || prefix === undefined || hidden === undefined) continue
    const from = match.index + prefix.length
    ranges.push({ from, to: from + hidden.length })
  }
}

const apiDeclarationTheme = EditorView.theme({
  '&': { fontSize: '13px' },
  '.cm-scroller': { lineHeight: '1.52' },
  '.cm-content': { padding: '12px 0 28px' },
  '.cm-line': { padding: '0 18px 0 7px' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '38px', padding: '0 8px 0 10px' },
})

function tokenDecorations(tokens: readonly ApiToken[], api?: ApiModel): DecorationSet {
  const navigable = new Set(
    api?.tokens.flatMap((token) => (token.declaration ? [token.declaration] : [])) ?? [],
  )
  return Decoration.set(
    tokens.flatMap((token) => {
      const target = token.target
      const declaration = token.declaration
      if (!target && !declaration) return []
      const canNavigate = target !== undefined && navigable.has(target)
      return [
        Decoration.mark({
          class: declaration ? 'api-symbol-declaration' : 'api-symbol-reference',
          attributes: canNavigate
            ? {
                'data-api-target': target,
                title: 'Click to peek · Command-click to open defining module',
              }
            : declaration
              ? {
                  'data-api-declaration': declaration,
                  title: 'Command-click to open defining module',
                }
              : { title: 'External declaration' },
        }).range(token.from, token.to),
      ]
    }),
    true,
  )
}

function tooltipAt(
  api: ApiModel | undefined,
  file: string,
  position: number,
  throws: readonly DetectedThrowReference[],
) {
  const thrown = throws.find((candidate) => candidate.from <= position && position <= candidate.to)
  if (thrown) {
    return {
      pos: thrown.from,
      end: thrown.to,
      above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'api-hover api-throws-hover'
        const heading = document.createElement('div')
        heading.className = 'api-hover-heading'
        heading.textContent = `throws ${thrown.code}`
        dom.append(heading)
        const description = document.createElement('p')
        description.textContent = 'Declared error in the API contract.'
        dom.append(description)
        return { dom }
      },
    }
  }
  if (!api) return null
  const token = tokenAt(
    api.tokens.filter((candidate) => candidate.file === file),
    position,
  )
  const identity = token?.target ?? token?.declaration
  if (!identity) return null
  const symbol = apiSymbol(api, identity)
  const metadata = api.metadata[identity]
  if (!symbol) return null
  return {
    pos: token!.from,
    end: token!.to,
    above: true,
    create() {
      const dom = document.createElement('div')
      dom.className = 'api-hover'
      const heading = document.createElement('div')
      heading.className = 'api-hover-heading'
      heading.textContent = `${symbol.kind} ${symbol.name}`
      dom.append(heading)
      if (metadata?.signature) {
        const signature = document.createElement('code')
        signature.textContent = metadata.signature
        dom.append(signature)
      }
      if (metadata?.documentation) {
        const description = document.createElement('p')
        description.textContent = metadata.documentation
        dom.append(description)
      }
      if (metadata?.remarks) {
        const remarks = document.createElement('p')
        remarks.textContent = metadata.remarks
        dom.append(remarks)
      }
      if (metadata?.errors.length) {
        const errors = document.createElement('small')
        errors.textContent = `Throws: ${metadata.errors.join(', ')}`
        dom.append(errors)
      }
      const coordinate = symbol.packageCoordinate ?? symbol.external
      if (coordinate) {
        const external = document.createElement('small')
        external.textContent = `External: ${coordinate}`
        dom.append(external)
      }
      if (token?.target && api.tokens.some((candidate) => candidate.declaration === token.target)) {
        const hint = document.createElement('small')
        hint.textContent = 'Click to peek · ⌘Click or ⌘↵ to open defining module'
        dom.append(hint)
      }
      return { dom }
    },
  }
}

function apiSymbol(
  api: ApiModel,
  identity: string,
):
  | {
      readonly kind: string
      readonly name: string
      readonly packageCoordinate?: string
      readonly external?: string
    }
  | undefined {
  const declaration = api.surface.declarations.find((candidate) => candidate.identity === identity)
  if (declaration) {
    return {
      kind: declaration.kind,
      name: declaration.name,
      ...(declaration.packageCoordinate
        ? { packageCoordinate: declaration.packageCoordinate }
        : {}),
      ...(declaration.location.external ? { external: declaration.location.external } : {}),
    }
  }
  for (const owner of api.surface.declarations) {
    if (!identity.startsWith(`${owner.identity}#`)) continue
    const name = identity.slice(owner.identity.length + 1)
    const member = [
      ...(owner.properties ?? []),
      ...(owner.callables ?? []),
      ...(owner.statics ?? []),
    ].find((candidate) => candidate.name === name)
    if (member) return { kind: member.callable ? 'method' : 'property', name }
  }
  return undefined
}

function tokenAt(tokens: readonly ApiToken[], position: number): ApiToken | undefined {
  return tokens.find((token) => token.from <= position && position <= token.to)
}
