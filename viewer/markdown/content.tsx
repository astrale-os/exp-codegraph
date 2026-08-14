import { useEffect, useMemo, useRef } from 'preact/hooks'

import { renderMarkdown } from '../../markdown/render.ts'
import { renderMermaidDiagrams, type MermaidIconPack } from './mermaid.ts'

export interface MarkdownContentProps {
  value: string
  html?: string
  compact?: boolean
  mermaidIconPacks?: readonly MermaidIconPack[]
}

export function MarkdownContent({ value, html, compact, mermaidIconPacks }: MarkdownContentProps) {
  const rendered = useMemo(() => html ?? renderMarkdown(value), [html, value])
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!content.current) return
    return renderMermaidDiagrams(content.current, mermaidIconPacks)
  }, [mermaidIconPacks, rendered])

  return (
    <div class={`markdown-content ${compact ? 'markdown-compact' : ''}`}>
      <div ref={content} dangerouslySetInnerHTML={{ __html: rendered }} />
    </div>
  )
}
