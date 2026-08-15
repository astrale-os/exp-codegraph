import type { Diagnostic } from '../../source/diagnostic.ts'
import type { ModuleIconResource, SvgIconElement } from '../resource/index.ts'
import type { ModuleFile } from './inventory.ts'

import { readBounded, sourceRevision } from '../../source/file.ts'

export const MAX_MODULE_ICON_BYTES = 8 * 1024

const MAX_ELEMENTS = 128
const MAX_DEPTH = 12
const MAX_ATTRIBUTES = 32
const MAX_ATTRIBUTE_VALUE_CHARACTERS = 4096

const ELEMENTS = new Set([
  'circle',
  'clipPath',
  'defs',
  'ellipse',
  'g',
  'line',
  'linearGradient',
  'mask',
  'path',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'stop',
  'svg',
])

const ATTRIBUTES = new Set([
  'clip-path',
  'clip-rule',
  'cx',
  'cy',
  'd',
  'fill',
  'fill-opacity',
  'fill-rule',
  'fr',
  'fx',
  'fy',
  'gradientTransform',
  'gradientUnits',
  'height',
  'id',
  'mask',
  'offset',
  'opacity',
  'points',
  'preserveAspectRatio',
  'r',
  'rx',
  'ry',
  'spreadMethod',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'transform',
  'vector-effect',
  'viewBox',
  'width',
  'x',
  'x1',
  'x2',
  'xmlns',
  'y',
  'y1',
  'y2',
])

export interface ModuleIconLoad {
  readonly resource?: ModuleIconResource
  readonly diagnostics: readonly Diagnostic[]
}

/** Read and admit one intentionally small, inert SVG icon without executing or forwarding markup. */
export async function loadModuleIcon(file: ModuleFile): Promise<ModuleIconLoad> {
  try {
    const text = await readBounded(file.absolute)
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > MAX_MODULE_ICON_BYTES) {
      throw new IconError(`Module icons cannot exceed ${MAX_MODULE_ICON_BYTES} bytes.`, 0)
    }
    const icon = new IconParser(text).parse()
    return {
      resource: {
        ref: './icon.svg',
        source: file.source,
        text,
        revision: sourceRevision(text),
        icon,
      },
      diagnostics: [],
    }
  } catch (error) {
    const offset = error instanceof IconError ? error.offset : 0
    const text = error instanceof IconReadError ? error.text : undefined
    const position = sourcePosition(text, offset)
    return {
      diagnostics: [
        {
          code: 'MODULE_ICON_INVALID',
          message: error instanceof Error ? error.message : String(error),
          file: file.source,
          line: position.line,
          column: position.column,
        },
      ],
    }
  }
}

class IconParser {
  private index = 0
  private elements = 0
  private readonly text: string

  constructor(text: string) {
    this.text = text
  }

  parse(): SvgIconElement {
    try {
      this.whitespace()
      const root = this.element(0)
      this.whitespace()
      if (this.index !== this.text.length) this.fail('Unexpected content after the SVG root.')
      if (root.name !== 'svg') this.fail('A module icon must have one svg root element.', 0)
      const viewBox = root.attributes.viewBox
      if (!viewBox || !validViewBox(viewBox)) {
        this.fail('The svg root must declare a finite, positive viewBox.', 0)
      }
      return root
    } catch (error) {
      if (error instanceof IconError)
        throw new IconReadError(error.message, error.offset, this.text)
      throw error
    }
  }

  private element(depth: number): SvgIconElement {
    if (depth > MAX_DEPTH) this.fail(`Module icons cannot exceed ${MAX_DEPTH} nested elements.`)
    if (++this.elements > MAX_ELEMENTS) {
      this.fail(`Module icons cannot exceed ${MAX_ELEMENTS} elements.`)
    }
    const start = this.index
    this.expect('<')
    if (this.peek('/') || this.peek('!') || this.peek('?')) {
      this.fail(
        'SVG declarations, comments, and unexpected closing elements are not allowed.',
        start,
      )
    }
    const name = this.name()
    if (!ELEMENTS.has(name)) this.fail(`SVG element ${name} is not allowed.`, start)
    if (depth > 0 && name === 'svg') this.fail('Nested svg elements are not allowed.', start)

    const attributes: Record<string, string> = Object.create(null) as Record<string, string>
    while (true) {
      this.whitespace()
      if (this.consume('/>')) return { name, attributes, children: [] }
      if (this.consume('>')) break
      if (Object.keys(attributes).length >= MAX_ATTRIBUTES) {
        this.fail(`SVG elements cannot exceed ${MAX_ATTRIBUTES} attributes.`)
      }
      const attributeStart = this.index
      const attribute = this.name()
      if (!ATTRIBUTES.has(attribute)) {
        this.fail(`SVG attribute ${attribute} is not allowed.`, attributeStart)
      }
      if (Object.hasOwn(attributes, attribute)) {
        this.fail(`SVG attribute ${attribute} is duplicated.`, attributeStart)
      }
      if (depth > 0 && (attribute === 'viewBox' || attribute === 'xmlns')) {
        this.fail(`SVG attribute ${attribute} is allowed only on the root.`, attributeStart)
      }
      this.whitespace()
      this.expect('=')
      this.whitespace()
      const value = this.attributeValue()
      validateAttribute(attribute, value, attributeStart)
      attributes[attribute] = value
    }

    if (
      depth === 0 &&
      attributes.xmlns !== undefined &&
      attributes.xmlns !== 'http://www.w3.org/2000/svg'
    ) {
      this.fail('The svg xmlns must be http://www.w3.org/2000/svg.', start)
    }

    const children: SvgIconElement[] = []
    while (true) {
      this.whitespace()
      if (this.consume('</')) {
        const closing = this.name()
        if (closing !== name) this.fail(`Expected closing element ${name}, found ${closing}.`)
        this.whitespace()
        this.expect('>')
        return { name, attributes, children }
      }
      if (this.index >= this.text.length) this.fail(`SVG element ${name} is not closed.`, start)
      if (!this.peek('<')) this.fail('Text content is not allowed in module icons.')
      children.push(this.element(depth + 1))
    }
  }

  private name(): string {
    const start = this.index
    while (this.index < this.text.length && /[A-Za-z0-9_.:-]/u.test(this.text[this.index]!)) {
      this.index++
    }
    if (this.index === start || !/[A-Za-z_:]/u.test(this.text[start]!)) {
      this.fail('Expected an SVG element or attribute name.', start)
    }
    return this.text.slice(start, this.index)
  }

  private attributeValue(): string {
    const quote = this.text[this.index]
    if (quote !== '"' && quote !== "'") this.fail('SVG attributes must use quoted values.')
    this.index++
    const start = this.index
    while (this.index < this.text.length && this.text[this.index] !== quote) this.index++
    if (this.index >= this.text.length) this.fail('SVG attribute value is not closed.', start)
    const value = this.text.slice(start, this.index)
    this.index++
    return value
  }

  private whitespace(): void {
    while (/\s/u.test(this.text[this.index] ?? '')) this.index++
  }

  private expect(value: string): void {
    if (!this.consume(value)) this.fail(`Expected ${JSON.stringify(value)}.`)
  }

  private consume(value: string): boolean {
    if (!this.text.startsWith(value, this.index)) return false
    this.index += value.length
    return true
  }

  private peek(value: string): boolean {
    return this.text.startsWith(value, this.index)
  }

  private fail(message: string, offset = this.index): never {
    throw new IconError(message, offset)
  }
}

class IconError extends Error {
  readonly offset: number

  constructor(message: string, offset: number) {
    super(message)
    this.offset = offset
  }
}

class IconReadError extends IconError {
  readonly text: string

  constructor(message: string, offset: number, text: string) {
    super(message, offset)
    this.text = text
  }
}

function validateAttribute(name: string, value: string, offset: number): void {
  if (value.length > MAX_ATTRIBUTE_VALUE_CHARACTERS || /[\u0000-\u001f\u007f<>&]/u.test(value)) {
    throw new IconError(`SVG attribute ${name} has an invalid value.`, offset)
  }
  if (name === 'xmlns') {
    if (value !== 'http://www.w3.org/2000/svg') {
      throw new IconError('The svg xmlns must be http://www.w3.org/2000/svg.', offset)
    }
    return
  }
  if (/\b(?:data|https?|javascript):|\/\//iu.test(value)) {
    throw new IconError(
      `SVG attribute ${name} cannot reference external or executable content.`,
      offset,
    )
  }
  if (name === 'id' && !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(value)) {
    throw new IconError('SVG ids must be simple local identifiers.', offset)
  }
  if (name === 'clip-path' || name === 'mask' || /url\s*\(/iu.test(value)) {
    if (!/^url\(#[A-Za-z][A-Za-z0-9_.-]*\)$/u.test(value)) {
      throw new IconError(`SVG attribute ${name} may reference only a local fragment.`, offset)
    }
  }
}

function validViewBox(value: string): boolean {
  const numbers = value
    .trim()
    .split(/[\s,]+/u)
    .map(Number)
  return (
    numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2]! > 0 && numbers[3]! > 0
  )
}

function sourcePosition(
  text: string | undefined,
  offset: number,
): { line: number; column: number } {
  if (text === undefined) return { line: 1, column: 1 }
  const before = text.slice(0, Math.max(0, offset)).split('\n')
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 }
}
