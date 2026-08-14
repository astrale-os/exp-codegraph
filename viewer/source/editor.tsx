import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import {
  bracketMatching,
  foldEffect,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  unfoldEffect,
} from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { SourceEditAdapter } from '../../application/interaction/editing.ts'

import { copyText } from './clipboard.ts'
import { persistFolds, restoreFolds } from './folds.ts'
import { semanticSyntaxHighlighting } from './highlight.ts'
import { pointerOffset } from './pointer.ts'
import { editorTheme } from './theme.ts'
import { ResetIcon, SaveIcon, SourceToolbar, type SaveState } from './toolbar.tsx'

interface YamlEditorProps {
  adapter?: SourceEditAdapter
  name?: string
  source: string
  text: string
  revision: string
  pointer?: string
}

interface SourceSnapshot {
  text: string
  revision: string
}

export function YamlEditor({
  adapter,
  name = 'api.d.ts',
  source,
  text,
  revision,
  pointer,
}: YamlEditorProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const draft = useRef(text)
  const saved = useRef<SourceSnapshot>({ text, revision })
  const latest = useRef<SourceSnapshot>({ text, revision })
  const conflict = useRef<SourceSnapshot | null>(null)
  const saveAction = useRef<() => void>(() => undefined)
  const [state, setState] = useState<SaveState>('saved')
  const [message, setMessage] = useState(adapter ? 'Saved' : 'Read only')
  const [copied, setCopied] = useState(false)

  const replaceDocument = (snapshot: SourceSnapshot) => {
    const editor = view.current
    if (!editor) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: snapshot.text } })
    draft.current = snapshot.text
    saved.current = snapshot
    latest.current = snapshot
    conflict.current = null
    setState('saved')
    setMessage(adapter ? 'Saved' : 'Read only')
  }

  const save = async () => {
    if (
      !adapter ||
      state === 'saving' ||
      state === 'conflict' ||
      draft.current === saved.current.text
    )
      return
    setState('saving')
    setMessage('Saving')
    try {
      const result = await adapter.save({
        source,
        revision: saved.current.revision,
        text: draft.current,
      })
      if (result.status === 'saved') {
        const snapshot = { text: draft.current, revision: result.revision }
        saved.current = snapshot
        latest.current = snapshot
        conflict.current = null
        setState('saved')
        setMessage('Saved')
      } else if (result.status === 'conflict') {
        const snapshot = { text: result.text, revision: result.revision }
        latest.current = snapshot
        conflict.current = snapshot
        setState('conflict')
        setMessage('Changed on disk')
      } else {
        setState('error')
        setMessage(result.message)
      }
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }
  saveAction.current = () => void save()

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: draft.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          semanticSyntaxHighlighting,
          highlightActiveLine(),
          EditorView.lineWrapping,
          EditorView.editable.of(Boolean(adapter)),
          EditorState.tabSize.of(2),
          indentUnit.of('  '),
          yaml(),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (saveAction.current(), true) },
            indentWithTab,
            ...foldKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.contentAttributes.of({
            'aria-label': `${name} editor`,
            autocapitalize: 'off',
            autocomplete: 'off',
            spellcheck: 'false',
          }),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              draft.current = update.state.doc.toString()
              if (!adapter) return
              const dirty = draft.current !== saved.current.text
              setState(dirty ? 'dirty' : 'saved')
              setMessage(dirty ? 'Unsaved' : 'Saved')
              persistFolds(source, update.view)
            } else if (
              update.transactions.some((transaction) =>
                transaction.effects.some(
                  (effect) => effect.is(foldEffect) || effect.is(unfoldEffect),
                ),
              )
            ) {
              persistFolds(source, update.view)
            }
          }),
        ],
      }),
    })
    view.current = editor
    restoreFolds(source, editor)
    return () => {
      persistFolds(source, editor)
      editor.destroy()
      view.current = null
    }
  }, [source, adapter])

  useEffect(() => {
    latest.current = { text, revision }
    if (revision === saved.current.revision) return
    if (draft.current === saved.current.text || draft.current === text) {
      replaceDocument({ text, revision })
    } else {
      conflict.current = { text, revision }
      setState('conflict')
      setMessage('Changed on disk')
    }
  }, [text, revision])

  useEffect(() => {
    const editor = view.current
    if (!editor || pointer === undefined) return
    const offset = pointerOffset(editor.state.doc.toString(), pointer)
    if (offset === undefined) return
    const page = { left: scrollX, top: scrollY }
    editor.dispatch({ selection: { anchor: offset } })
    editor.contentDOM.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => {
      const line = editor.lineBlockAt(offset)
      editor.scrollDOM.scrollTop = Math.max(0, line.top - editor.scrollDOM.clientHeight / 2)
      scrollTo(page)
    })
    return () => cancelAnimationFrame(frame)
  }, [pointer, source])

  useEffect(() => {
    if (state !== 'dirty' && state !== 'conflict' && state !== 'error') return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [state])

  const copy = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
    void copyText(draft.current)
  }

  return (
    <section class="source-file source-editor" aria-label="YAML source editor">
      <SourceToolbar name={name} state={state} message={message} copied={copied} onCopy={copy}>
        {(state === 'dirty' || state === 'error') && (
          <button
            class="source-action source-action-secondary"
            type="button"
            onClick={() => replaceDocument(saved.current)}
          >
            <ResetIcon />
            Revert
          </button>
        )}
        {state === 'conflict' && (
          <button
            class="source-action source-action-secondary"
            type="button"
            onClick={() => replaceDocument(conflict.current ?? latest.current)}
          >
            <ResetIcon />
            Reload
          </button>
        )}
        {adapter && (
          <button
            class="source-action source-action-primary"
            type="button"
            disabled={state !== 'dirty' && state !== 'error'}
            onClick={() => void save()}
          >
            <SaveIcon />
            Save
            <kbd>⌘S</kbd>
          </button>
        )}
      </SourceToolbar>
      <div class="editor-host" ref={host} />
    </section>
  )
}

export { RawSource } from './raw.tsx'
