import { parseDocument } from 'yaml'

import { pointerSegments } from '../../reference/pointer.ts'

export function pointerOffset(text: string, pointer: string): number | undefined {
  try {
    const document = parseDocument(text, { strict: true, uniqueKeys: true, version: '1.2' })
    const segments = pointerSegments(pointer)
    let node: unknown
    for (let length = segments.length; length >= 0; length--) {
      node = document.getIn(segments.slice(0, length), true)
      if (node && typeof node === 'object' && 'range' in node) break
    }
    const range =
      node && typeof node === 'object' && 'range' in node
        ? (node as { range?: [number] }).range
        : undefined
    return range?.[0] ?? 0
  } catch {
    return undefined
  }
}
