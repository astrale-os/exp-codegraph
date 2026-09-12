import { createAnalysisIdentityHash } from '../identity/hash.ts'
import { compareUnicodeScalars } from '../identity/model.ts'
import { types } from 'node:util'
import type { FactShardDigest } from '../identity/index.ts'
import type { Fact, FactShard } from './types.ts'

type SemanticFact = Omit<Fact, 'generation'>
type ShardIdentity = Omit<FactShard, 'digest' | 'facts'> & { readonly facts: readonly SemanticFact[] }
const UNSUPPORTED = Symbol('non-JSON admission value')
const ARRAY = Array
const ARRAY_PROTOTYPE = Array.prototype
const ARRAY_MAP = Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'map')
const ARRAY_CONSTRUCTOR = Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'constructor')
const ARRAY_SPECIES = Object.getOwnPropertyDescriptor(ARRAY, Symbol.species)
const NATIVE_ARRAYS = ARRAY_CONSTRUCTOR?.value === ARRAY && nativeFunction(ARRAY, 'Array') &&
  nativeFunction(ARRAY_MAP?.value, 'map') && nativeFunction(ARRAY_SPECIES?.get, 'get [Symbol.species]')

/** Private, owned JSON ingress only. The generic identity path remains the fallback. */
export function hashOwnedFactShard(input: ShardIdentity): {
  readonly digest: FactShardDigest
  readonly semanticPayloadBytes: number
} | undefined {
  // These hooks would change canonical() or JSON.stringify() even for fresh
  // plain data. Leave their observation and result to the generic encoder.
  if (!NATIVE_ARRAYS || Array !== ARRAY || Array.prototype !== ARRAY_PROTOTYPE ||
    Object.getPrototypeOf(ARRAY_PROTOTYPE) !== Object.prototype ||
    !sameDescriptor(Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'map'), ARRAY_MAP) ||
    !sameDescriptor(Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'constructor'), ARRAY_CONSTRUCTOR) ||
    !sameDescriptor(Object.getOwnPropertyDescriptor(ARRAY, Symbol.species), ARRAY_SPECIES) ||
    Object.hasOwn(Object.prototype, 'toJSON') || Object.hasOwn(Array.prototype, 'toJSON')) return
  const writer = new OwnedJSONWriter(input.namespace)
  try {
    writer.part('{')
    if (input.capabilities) {
      writer.part('"capabilities":')
      writer.value(input.capabilities)
      writer.part(',')
    }
    writer.part('"completion":')
    writer.value(input.completion)
    writer.part(',"facts":[')
    let semanticPayloadBytes = 0
    for (let index = 0; index < input.facts.length; index++) {
      if (index) writer.part(',')
      const fact = input.facts[index]!
      writer.part('{"completeness":')
      writer.value(fact.completeness)
      writer.part(',"id":')
      writer.value(fact.id)
      writer.part(',"kind":')
      writer.value(fact.kind)
      writer.part(',"namespace":')
      writer.value(fact.namespace)
      writer.part(',"payload":')
      const before = writer.bytes
      writer.value(fact.payload)
      semanticPayloadBytes += writer.bytes - before
      writer.part(',"provenance":')
      writer.value(fact.provenance)
      writer.part(',"schemaVersion":')
      writer.value(fact.schemaVersion)
      writer.part(',"subject":')
      writer.value(fact.subject)
      writer.part('}')
    }
    writer.part('],"key":')
    writer.value(input.key)
    writer.part(',"namespace":')
    writer.value(input.namespace)
    writer.part(',"schemaVersion":')
    writer.value(input.schemaVersion)
    writer.part('}')
    return { digest: writer.finish(), semanticPayloadBytes }
  } catch (error) {
    if (error !== UNSUPPORTED) throw error
    // Reuse the already decoded semantic input. Do not invoke a decoder again,
    // publish a certificate, or change the generic path's error timing.
    return undefined
  }
}

interface EncodedString { readonly canonical: string; readonly bytes: number }
interface ObjectShape { readonly keys: readonly string[]; readonly ordered: readonly string[] }

class OwnedJSONWriter {
  readonly #hash: ReturnType<typeof createAnalysisIdentityHash>
  readonly #strings = new Map<string, EncodedString>()
  readonly #shapes = new Map<number, ObjectShape[]>()
  #shapeCount = 0
  #parts: string[] = []
  #characters = 0
  // Ordinary JSON UTF-8 bytes, before the identity-only separator escapes.
  bytes = 0

  constructor(namespace: string) { this.#hash = createAnalysisIdentityHash('fact-shard-digest', namespace) }

  part(value: string, bytes = value.length): void {
    this.bytes += bytes
    if (this.#characters + value.length >= 32_768) this.flush()
    if (value.length >= 32_768) this.#hash.update(value)
    else { this.#parts.push(value); this.#characters += value.length }
  }

  value(value: unknown): void {
    if (value === null) { this.part('null'); return }
    switch (typeof value) {
      case 'string': this.string(value); return
      case 'number': this.part(Number.isFinite(value) ? String(value) : 'null'); return
      case 'boolean': this.part(value ? 'true' : 'false'); return
      case 'object': break
      default: throw UNSUPPORTED
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw UNSUPPORTED
      this.part('[')
      for (let index = 0; index < value.length; index++) {
        if (index) this.part(',')
        this.value(value[index])
      }
      this.part(']')
      return
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw UNSUPPORTED
    const record = value as Record<string, unknown>
    this.part('{')
    let separator = false
    for (const key of this.keys(record)) {
      const entry = record[key]
      if (entry === undefined) continue
      if (separator) this.part(',')
      this.string(key)
      this.part(':')
      this.value(entry)
      separator = true
    }
    this.part('}')
  }

  finish(): FactShardDigest {
    this.flush()
    return `fact-shard-digest:${this.#hash.digest('hex')}` as FactShardDigest
  }

  private string(value: string): void {
    let encoded = value.length <= 256 ? this.#strings.get(value) : undefined
    if (!encoded) {
      const json = JSON.stringify(value)
      encoded = { canonical: json.replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029'),
        bytes: Buffer.byteLength(json) }
      // Both caches belong to this one admission. Bound their entry count and
      // retained key size; a giant open value must not become a cached token.
      if (this.#strings.size < 256 && value.length <= 256) this.#strings.set(value, encoded)
    }
    this.part(encoded.canonical, encoded.bytes)
  }

  private keys(value: object): readonly string[] {
    const keys = Object.keys(value)
    const shapes = this.#shapes.get(keys.length)
    if (shapes) {
      for (const shape of shapes) {
        let matches = true
        for (let index = 0; index < keys.length; index++) {
          if (keys[index] !== shape.keys[index]) { matches = false; break }
        }
        if (matches) return shape.ordered
      }
    }
    const ordered = [...keys].sort(compareJSONKeys)
    if (this.#shapeCount < 64 && keys.length <= 32 && keys.every(key => key.length <= 256)) {
      const shape = { keys, ordered }
      if (shapes) shapes.push(shape)
      else this.#shapes.set(keys.length, [shape])
      this.#shapeCount++
    }
    return ordered
  }

  private flush(): void {
    if (this.#characters) this.#hash.update(this.#parts.join(''))
    this.#parts.length = 0
    this.#characters = 0
  }
}

function compareJSONKeys(left: string, right: string): number {
  // Object.fromEntries(canonical entries) still enumerates array-index keys
  // numerically first when JSON.stringify runs. Other keys use scalar order.
  const a = arrayIndex(left)
  const b = arrayIndex(right)
  return a !== undefined ? b !== undefined ? a - b : -1
    : b !== undefined ? 1 : compareUnicodeScalars(left, right)
}

function arrayIndex(key: string): number | undefined {
  const value = Number(key)
  return Number.isInteger(value) && value >= 0 && value < 0xffff_ffff && String(value) === key
    ? value : undefined
}

function nativeFunction(value: unknown, name: string): boolean {
  return typeof value === 'function' && !types.isProxy(value) &&
    Function.prototype.toString.call(value).replace(/\s+/gu, ' ').trim() === `function ${name}() { [native code] }`
}

function sameDescriptor(value: PropertyDescriptor | undefined, expected: PropertyDescriptor | undefined): boolean {
  return value !== undefined && expected !== undefined && value.value === expected.value && value.get === expected.get &&
    value.set === expected.set && value.writable === expected.writable &&
    value.enumerable === expected.enumerable && value.configurable === expected.configurable
}
