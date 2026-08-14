import type { SvgIconElement } from '../../specification/resource/index.ts'
import type { MermaidIconPack } from '../markdown/mermaid.ts'

import type {
  ModuleTopology,
  ModuleTopologyEdge,
  ModuleTopologyMode,
  ModuleTopologyNode,
} from './module-topology-model.ts'

const ICON_PACK = 'astralemodule'

export function moduleTopologyIconPack(
  topology: ModuleTopology,
  includeContext: boolean,
): MermaidIconPack {
  const nodes = includeContext ? [...topology.modules, ...topology.context] : topology.modules
  return {
    name: ICON_PACK,
    icons: {
      prefix: ICON_PACK,
      width: 24,
      height: 24,
      icons: Object.fromEntries(
        nodes.flatMap((node) => {
          const icon = node.entry.icon
          return icon ? [[iconKey(node.id), { body: iconBody(icon) }]] : []
        }),
      ),
    },
  }
}

export function moduleTopologyMermaid(
  topology: ModuleTopology,
  mode: ModuleTopologyMode,
  includeContext: boolean,
): string {
  const context = mode === 'dependencies' && includeContext ? topology.context : []
  const nodes = [...topology.modules, ...context]
  const edges = mode === 'composition'
    ? topology.composition
    : [
        ...topology.dependencies,
        ...(includeContext ? topology.contextDependencies : []),
      ]
  const lines = [
    mermaidInit(),
    'flowchart LR',
    `subgraph module_scope["${mermaidLabel(topology.scope)}"]`,
    'direction LR',
    ...topology.modules.map(nodeDefinition),
    'end',
    ...context.map(nodeDefinition),
    ...edges.map(edgeDefinition),
    'style module_scope fill:transparent,stroke:#718096,stroke-width:1.2px,stroke-dasharray:4 4',
    ...nodes.flatMap(nodeStyle),
  ]
  const secondaryEdges = edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.kind === 'context' || edge.kind === 'scope')
  if (secondaryEdges.length) {
    lines.push(
      `linkStyle ${secondaryEdges.map(({ index }) => index).join(',')} stroke-dasharray:4 4,opacity:0.48`,
    )
  }
  return lines.join('\n')
}

function nodeDefinition(node: ModuleTopologyNode): string {
  const icon = node.entry.icon ? `${ICON_PACK}:${iconKey(node.id)}` : 'blank'
  const height = node.kind === 'root' ? 54 : 48
  return `${node.id}@{ icon: "${icon}", form: "rounded", label: "${mermaidLabel(node.label)}", pos: "b", h: ${height} }`
}

function edgeDefinition(edge: ModuleTopologyEdge): string {
  if (edge.kind === 'composition') return `${edge.from} --- ${edge.to}`
  const arrow = edge.kind === 'context' || edge.kind === 'scope' ? '-.->' : '-->'
  const count = edge.kind !== 'scope' && edge.declarations > 1
    ? `|${edge.declarations} declarations|`
    : ''
  return `${edge.from} ${arrow}${count} ${edge.to}`
}

function nodeStyle(node: ModuleTopologyNode): string[] {
  const color = iconColor(node.entry.icon)
  const width = node.kind === 'root' ? '2.5px' : '1.5px'
  const dash = node.kind === 'context' ? ',stroke-dasharray:3 3' : ''
  return [
    `classDef topology_${node.id} fill:transparent,stroke:${color},stroke-width:${width},color:${color}${dash}`,
    `class ${node.id} topology_${node.id}`,
  ]
}

function mermaidInit(): string {
  const settings = {
    flowchart: {
      curve: 'basis',
      nodeSpacing: 34,
      rankSpacing: 50,
      htmlLabels: false,
    },
  }
  return `%%{init: ${JSON.stringify(settings)}}%%`
}

function iconKey(id: string): string {
  return id.replaceAll('_', '-')
}

function iconColor(icon: SvgIconElement | undefined): string {
  const stroke = icon?.attributes.stroke
  return stroke && /^#[0-9a-f]{6}$/iu.test(stroke) ? stroke : '#718096'
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
