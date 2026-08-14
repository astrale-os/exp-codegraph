import { EditorView } from '@codemirror/view'

export const editorTheme = EditorView.theme({
  '&': {
    height: 'min(72vh, 880px)',
    color: 'var(--ink)',
    backgroundColor: 'var(--code-bg)',
    fontSize: '14px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.62',
    overscrollBehavior: 'contain',
  },
  '.cm-content': { padding: '16px 0 34px', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 20px 0 8px' },
  '.cm-gutters': {
    color: 'var(--faint)',
    backgroundColor: 'var(--code-gutter)',
    borderRight: '1px solid var(--line)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 9px 0 12px', minWidth: '42px' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 8px 0 2px', cursor: 'pointer' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 5%, transparent)' },
  '.cm-activeLineGutter': {
    color: 'var(--ink)',
    backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
})
