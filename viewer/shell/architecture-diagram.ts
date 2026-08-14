import type { SvgIconElement } from '../../specification/resource/index.ts'
import type { MermaidIconPack } from '../markdown/mermaid.ts'
import type {
  ArchitectureLayer,
  ArchitectureRelationship,
  NavigationFamily,
} from './navigation-scope.ts'

export type ArchitectureDepth = 'layers' | 'modules'
export type ArchitectureView = 'flow' | 'dependencies'

const ICON_PACK = 'astrale'

export function architectureIconPack(
  families: readonly NavigationFamily[],
): MermaidIconPack {
  return {
    name: ICON_PACK,
    icons: {
      prefix: ICON_PACK,
      width: 24,
      height: 24,
      icons: Object.fromEntries(
        families.flatMap((family) => {
          const icon = family.identitySpec.icon
          return icon ? [[familyIconName(family.name), { body: iconBody(icon) }]] : []
        }),
      ),
    },
  }
}

export function systemFlowMermaid(families: readonly NavigationFamily[]): string {
  const byName = new Map(families.map((family) => [family.name, family]))
  const nodes = ['client', 'protocol', 'server', 'ports', 'runtime', 'backend', 'core', 'dsl']
    .flatMap((name) => byName.has(name) ? [flowNode(name, byName.get(name)!)] : [])
  const host = byName.get('host')
  const hostColor = familyColor(host)
  const lines = [
    mermaidInit(),
    'flowchart LR',
    ...nodes.filter((node) => !['server', 'ports', 'runtime', 'backend'].some(
      (name) => node.startsWith(`${name}@`),
    )),
    'subgraph host_boundary[" "]',
    'direction LR',
    ...nodes.filter((node) => ['server', 'ports', 'runtime', 'backend'].some(
      (name) => node.startsWith(`${name}@`),
    )),
    byName.has('ports') ? flowNode('ports_backend', byName.get('ports')!, 'ports') : '',
    'end',
    ...flowEdges(byName),
    `style host_boundary fill:transparent,stroke:${hostColor},stroke-width:1.5px,stroke-dasharray:4 4`,
    ...['client', 'protocol', 'server', 'ports', 'runtime', 'backend', 'core', 'dsl'].flatMap((name) => {
      const family = byName.get(name)
      if (!family) return []
      const id = safeId(family.name)
      const color = familyColor(family)
      const nodesForFamily = family.name === 'ports'
        ? 'ports,ports_backend'
        : id
      return [
        `classDef family_${id} fill:transparent,stroke:${color},stroke-width:1.5px,color:${color}`,
        `class ${nodesForFamily} family_${id}`,
      ]
    }),
  ]
  return lines.filter(Boolean).join('\n')
}

export function dependencyMermaid(
  layers: readonly ArchitectureLayer[],
  relationships: readonly ArchitectureRelationship[],
  depth: ArchitectureDepth,
  familyFilter?: string,
): string {
  const allFamilies = layers.flatMap((layer) => layer.families)
  const included = dependencyFamilyNames(allFamilies, relationships, familyFilter)
  const visibleLayers = layers.flatMap((layer) => {
    const families = layer.families.filter((family) => included.has(family.name))
    return families.length ? [{ ...layer, families }] : []
  })
  const lines = [mermaidInit(), 'flowchart LR']
  for (const layer of [...visibleLayers].reverse()) {
    lines.push(`subgraph layer_${safeId(layer.key)}["${mermaidLabel(layer.name)}"]`, 'direction TB')
    for (const family of layer.families) {
      lines.push(flowNode(family.name, family))
    }
    lines.push('end')
  }
  for (const relationship of relationships) {
    if (!included.has(relationship.from) || !included.has(relationship.to)) continue
    const label = depth === 'modules' ? `|${mermaidLabel(relationship.label)}|` : ''
    lines.push(`${safeId(relationship.from)} -->${label} ${safeId(relationship.to)}`)
  }
  for (const family of allFamilies) {
    if (!included.has(family.name)) continue
    const color = familyColor(family)
    const selected = family.name === familyFilter ? '3px' : '1.5px'
    lines.push(
      `classDef family_${safeId(family.name)} fill:transparent,stroke:${color},stroke-width:${selected},color:${color}`,
      `class ${safeId(family.name)} family_${safeId(family.name)}`,
    )
  }
  return lines.join('\n')
}

function flowNode(
  id: string,
  family: NavigationFamily,
  label = family.name,
  height = 54,
): string {
  return `${safeId(id)}@{ icon: "${familyIcon(family)}", form: "rounded", label: "${mermaidLabel(label)}", pos: "b", h: ${height} }`
}

function flowEdges(byName: ReadonlyMap<string, NavigationFamily>): string[] {
  const primary = [
    ['client', 'protocol'],
    ['protocol', 'server'],
    ['server', 'ports'],
    ['ports', 'runtime'],
    ['runtime', 'ports_backend'],
    ['ports_backend', 'backend'],
  ].flatMap(([from, to]) => {
    const fromFamily = from === 'ports_backend' ? 'ports' : from
    const toFamily = to === 'ports_backend' ? 'ports' : to
    return byName.has(fromFamily) && byName.has(toFamily) ? [`${from} --> ${to}`] : []
  })
  const shared = byName.has('core')
    ? ['client', 'protocol', 'server', 'ports', 'runtime', 'ports_backend', 'backend']
    .flatMap((name) => {
      const family = name === 'ports_backend' ? 'ports' : name
      return byName.has(family) ? [`${name} -.-> core`] : []
    })
    : []
  const dsl = byName.has('dsl')
    ? ['protocol', 'ports', 'runtime', 'ports_backend'].flatMap((name) => {
        const family = name === 'ports_backend' ? 'ports' : name
        return byName.has(family) ? [`${name} -.-> dsl`] : []
      })
    : []
  return [...primary, ...shared, ...dsl]
}

function dependencyFamilyNames(
  families: readonly NavigationFamily[],
  relationships: readonly ArchitectureRelationship[],
  familyFilter?: string,
): ReadonlySet<string> {
  if (!familyFilter) return new Set(families.map((family) => family.name))
  const included = new Set([familyFilter])
  for (const relationship of relationships) {
    if (relationship.from === familyFilter || relationship.to === familyFilter) {
      included.add(relationship.from)
      included.add(relationship.to)
    }
  }
  return included
}

function mermaidInit(): string {
  const settings = { flowchart: { curve: 'basis', nodeSpacing: 36, rankSpacing: 52, htmlLabels: false } }
  return `%%{init: ${JSON.stringify(settings)}}%%`
}

function familyIcon(family: NavigationFamily): string {
  return family.identitySpec.icon ? `${ICON_PACK}:${familyIconName(family.name)}` : 'blank'
}

function familyIconName(name: string): string {
  return safeId(name).replaceAll('_', '-')
}

function familyColor(family: NavigationFamily | undefined): string {
  const stroke = family?.identitySpec.icon?.attributes.stroke
  return stroke && /^#[0-9a-f]{6}$/iu.test(stroke) ? stroke : '#718096'
}

function safeId(value: string): string {
  const id = value.toLocaleLowerCase().replace(/[^a-z0-9_-]+/gu, '_')
  return /^[a-z_]/u.test(id) ? id : `family_${id}`
}

function mermaidLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ')
}

function iconBody(icon: SvgIconElement): string {
  const attributes = Object.entries(icon.attributes)
    .filter(([name]) => name !== 'viewBox' && name !== 'xmlns')
    .map(([name, value]) => `${name}="${escapeXml(value)}"`)
    .join(' ')
  return `<g${attributes ? ` ${attributes}` : ''}>${icon.children.map(iconElement).join('')}</g>`
}

function iconElement(element: SvgIconElement): string {
  const attributes = Object.entries(element.attributes)
    .map(([name, value]) => `${name}="${escapeXml(value)}"`)
    .join(' ')
  const start = `<${element.name}${attributes ? ` ${attributes}` : ''}`
  return element.children.length
    ? `${start}>${element.children.map(iconElement).join('')}</${element.name}>`
    : `${start}/>`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
