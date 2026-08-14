import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { ExampleResource } from '../../specification/resource/index.ts'
import type { RawSourceLink } from '../source/raw.tsx'

import { RawSource } from '../source/raw.tsx'

export interface PresentedExample {
  readonly id: string
  readonly title: string
  readonly groups: readonly string[]
  readonly resource: ExampleResource
}

export interface ExampleGroup {
  readonly name?: string
  readonly path: readonly string[]
  readonly examples: readonly PresentedExample[]
  readonly groups: readonly ExampleGroup[]
}

export function ExamplesView({
  resources,
  sourceLinks,
}: {
  resources: readonly ExampleResource[]
  sourceLinks?: (source: string) => readonly RawSourceLink[]
}) {
  const examples = useMemo(() => resources.map(presentExample), [resources])
  const tree = useMemo(() => groupExamples(examples), [examples])
  const [active, setActive] = useState(examples[0]?.id)
  const scrollFrame = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0]
        if (visible?.target.id) setActive(visible.target.id)
      },
      { rootMargin: '-12% 0px -72% 0px', threshold: [0, 1] },
    )
    for (const example of examples) {
      const element = document.getElementById(example.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [examples])

  useEffect(
    () => () => {
      if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current)
    },
    [],
  )

  const select = (id: string) => {
    setActive(id)
    const element = document.getElementById(id)
    if (!element) return
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = quickScrollTo(element, (frame) => {
      scrollFrame.current = frame
    })
  }

  return (
    <div class="examples-reader">
      <aside class="examples-index">
        <header>
          <span>Examples</span>
          <small>{examples.length}</small>
        </header>
        <nav aria-label="Examples on this page">
          <ExampleNavigation group={tree} active={active} select={select} />
        </nav>
      </aside>
      <main class="examples-feed">
        <ExampleGroupContent group={tree} sourceLinks={sourceLinks} />
      </main>
    </div>
  )
}

const MAX_SCROLL_DURATION_MS = 180
const MIN_SCROLL_DURATION_MS = 90
const EXAMPLE_SCROLL_OFFSET_PX = 18

function quickScrollTo(
  element: HTMLElement,
  updateFrame: (frame?: number) => void,
): number | undefined {
  const start = window.scrollY
  const target = Math.max(0, start + element.getBoundingClientRect().top - EXAMPLE_SCROLL_OFFSET_PX)
  const distance = target - start
  if (Math.abs(distance) < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.scrollTo({ top: target, behavior: 'auto' })
    updateFrame(undefined)
    return undefined
  }

  const duration = Math.min(
    MAX_SCROLL_DURATION_MS,
    MIN_SCROLL_DURATION_MS + Math.abs(distance) / 40,
  )
  const started = performance.now()
  const tick = (now: number) => {
    const progress = Math.min((now - started) / duration, 1)
    const eased = 1 - (1 - progress) ** 3
    window.scrollTo({ top: start + distance * eased, behavior: 'auto' })
    if (progress < 1) updateFrame(requestAnimationFrame(tick))
    else updateFrame(undefined)
  }
  return requestAnimationFrame(tick)
}

function ExampleNavigation({
  group,
  active,
  select,
}: {
  group: ExampleGroup
  active?: string
  select(id: string): void
}) {
  return (
    <div class={group.name ? 'examples-index-group' : 'examples-index-root'}>
      {group.name && <strong>{group.name}</strong>}
      {group.examples.map((example) => (
        <button
          type="button"
          aria-current={active === example.id ? 'true' : undefined}
          onClick={() => select(example.id)}
          title={example.title}
          key={example.id}
        >
          {example.title}
        </button>
      ))}
      {group.groups.map((nested) => (
        <ExampleNavigation
          group={nested}
          active={active}
          select={select}
          key={nested.path.join('/')}
        />
      ))}
    </div>
  )
}

function ExampleGroupContent({
  group,
  sourceLinks,
}: {
  group: ExampleGroup
  sourceLinks?: (source: string) => readonly RawSourceLink[]
}) {
  const level = group.path.length
  return (
    <section class={group.name ? 'example-group' : 'example-group-root'}>
      {group.name && (level === 1 ? <h2>{group.name}</h2> : <h3>{group.name}</h3>)}
      <div class="example-group-content">
        {group.examples.map((example) => (
          <article class="example-entry" id={example.id} key={example.id}>
            <div class="example-source">
              <RawSource
                name={example.resource.source}
                label={example.title}
                message={example.resource.against === 'api' ? 'API contract' : 'Implementation'}
                text={example.resource.text}
                links={sourceLinks?.(example.resource.source)}
              />
            </div>
          </article>
        ))}
        {group.groups.map((nested) => (
          <ExampleGroupContent
            group={nested}
            sourceLinks={sourceLinks}
            key={nested.path.join('/')}
          />
        ))}
      </div>
    </section>
  )
}

export function presentExample(resource: ExampleResource): PresentedExample {
  const parts = relativeExampleParts(resource.ref)
  const file = parts.at(-1) ?? resource.ref
  const stem = file.replace(/\.[^.]+$/u, '')
  return {
    id: `example-${titleSlug(stem)}-${stableSuffix(resource.ref)}`,
    title: titleify(stem),
    groups: parts.slice(0, -1).map(titleify),
    resource,
  }
}

export function groupExamples(examples: readonly PresentedExample[]): ExampleGroup {
  const root = mutableGroup([], undefined)
  for (const example of examples) {
    let group = root
    for (const name of example.groups) {
      let nested = group.groups.find((candidate) => candidate.name === name)
      if (!nested) {
        nested = mutableGroup([...group.path, name], name)
        group.groups.push(nested)
      }
      group = nested
    }
    group.examples.push(example)
  }
  return root
}

interface MutableExampleGroup {
  name?: string
  path: string[]
  examples: PresentedExample[]
  groups: MutableExampleGroup[]
}

function mutableGroup(path: string[], name: string | undefined): MutableExampleGroup {
  return { ...(name ? { name } : {}), path, examples: [], groups: [] }
}

function relativeExampleParts(reference: string): string[] {
  const parts = reference.replace(/^\.\//u, '').split('/').filter(Boolean)
  const root = parts.lastIndexOf('examples')
  return root >= 0 ? parts.slice(root + 1) : parts
}

function titleify(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[-_.]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function titleSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'example'
  )
}

function stableSuffix(value: string): string {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
