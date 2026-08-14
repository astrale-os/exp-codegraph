import { syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'

export const semanticSyntaxHighlighting = syntaxHighlighting(classHighlighter)
