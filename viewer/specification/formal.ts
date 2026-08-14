import { renderToString } from 'katex'

export interface FormalMathLink {
  readonly from: number
  readonly to: number
  readonly href: string
}

const rendered = new Map<string, string>()
const MAX_RENDERED_FORMULAS = 512

/** Render authored formal notation as inert, accessible display mathematics. */
export function renderFormalMath(
  value: string,
  links: readonly FormalMathLink[] = [],
): string | undefined {
  if (!value) return undefined
  const key = JSON.stringify([value, links])
  const cached = rendered.get(key)
  if (cached) {
    rendered.delete(key)
    rendered.set(key, cached)
    return cached
  }
  try {
    const trustedLinks = new Set(links.map((link) => link.href))
    const markup = renderToString(linkFormula(value, links), {
      displayMode: true,
      errorColor: '#b42318',
      output: 'htmlAndMathml',
      strict: 'ignore',
      throwOnError: false,
      trust: (context) =>
        context.command === '\\href' &&
        'protocol' in context &&
        context.protocol === '_relative' &&
        'url' in context &&
        !!context.url?.startsWith('?spec=') &&
        trustedLinks.has(context.url),
    })
    rendered.set(key, markup)
    while (rendered.size > MAX_RENDERED_FORMULAS) rendered.delete(rendered.keys().next().value!)
    return markup
  } catch {
    return undefined
  }
}

function linkFormula(value: string, links: readonly FormalMathLink[]): string {
  if (links.length === 0) return value
  let output = ''
  let cursor = 0
  for (const link of links) {
    if (
      link.from < cursor ||
      link.to <= link.from ||
      link.to > value.length ||
      !link.href.startsWith('?spec=') ||
      link.href.includes('}')
    ) {
      continue
    }
    output += value.slice(cursor, link.from)
    output += `\\href{${link.href}}{${value.slice(link.from, link.to)}}`
    cursor = link.to
  }
  return `${output}${value.slice(cursor)}`
}
