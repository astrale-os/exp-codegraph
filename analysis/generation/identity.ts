import { types } from 'node:util'
import type { FactShardReference } from '../facts/index.ts'
import { deriveAnalysisId, type AnalysisGenerationId } from '../identity/index.ts'
import { createAnalysisIdentityHash } from '../identity/hash.ts'
import { stableJson } from '../identity/model.ts'
import type { AnalysisGeneration } from './types.ts'

// A weak cache cannot retain evicted generations. Only immutable standard
// references qualify, including their optional scalar capabilities array.
const REFERENCES = new WeakMap<FactShardReference, string>()
const ARRAY = Array
const ARRAY_PROTOTYPE = Array.prototype
const ARRAY_DESCRIPTORS = Object.getOwnPropertyDescriptors(ARRAY_PROTOTYPE)
const ARRAY_KEYS = Reflect.ownKeys(ARRAY_DESCRIPTORS)
const ARRAY_SPECIES = Object.getOwnPropertyDescriptor(ARRAY, Symbol.species)
const NATIVE_ARRAY_MAPPING = nativeFunction(ARRAY, 'Array') &&
  nativeFunction(Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'map')?.value, 'map') &&
  Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'constructor')?.value === ARRAY &&
  nativeFunction(ARRAY_SPECIES?.get, 'get [Symbol.species]')

export function hashGenerationIdentity(
  generation: Omit<AnalysisGeneration, 'id' | 'sequence'>,
  manifest: readonly FactShardReference[],
): AnalysisGenerationId {
  // Keep the existing input-read order and the exact v1 canonical preimage.
  const input = {
    universe: generation.universe,
    producer: generation.producer,
    sourceManifest: generation.sourceManifest,
    capabilities: [...new Set(generation.capabilities)].sort(),
    manifest: [...manifest].sort((left, right) => left.key.localeCompare(right.key)),
  }
  const generic = () => deriveAnalysisId('generation', 'astrale.analysis.generation.v1', input)
  if (!ordinaryArrayIntrinsics() ||
    typeof input.universe !== 'string' || typeof input.sourceManifest !== 'string' ||
    !flatRecord(input.producer) || input.capabilities.some(value => typeof value !== 'string')) return generic()
  const hash = createAnalysisIdentityHash('generation', 'astrale.analysis.generation.v1')
  hash.update('{"capabilities":').update(stableJson(input.capabilities)).update(',"manifest":[')
  let pending: string[] = []
  let characters = 0
  for (let index = 0; index < input.manifest.length; index++) {
    const reference = input.manifest[index]!
    // A custom getter/toJSON/nested object keeps the original whole-value
    // canonicalizer, including its observation order and JSON key semantics.
    let encoded = REFERENCES.get(reference)
    if (encoded === undefined) {
      if (!immutableReference(reference)) return generic()
      encoded = stableJson(reference)
      REFERENCES.set(reference, encoded)
    }
    if (index) pending.push(',')
    pending.push(encoded)
    characters += encoded.length + 1
    // The complete SHA still visits every byte, but unchanged references are
    // not canonicalized again and no whole-manifest JSON graph/string exists.
    if (characters >= 32_768) { hash.update(pending.join('')); pending = []; characters = 0 }
  }
  if (pending.length) hash.update(pending.join(''))
  hash.update('],"producer":').update(stableJson(input.producer))
    .update(',"sourceManifest":').update(stableJson(input.sourceManifest))
    .update(',"universe":').update(stableJson(input.universe)).update('}')
  return `generation:${hash.digest('hex')}` as AnalysisGenerationId
}

function immutableReference(value: unknown): value is FactShardReference {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Object.isFrozen(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const keys = Reflect.ownKeys(value)
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!descriptor.enumerable || !('value' in descriptor)) return false
    switch (key) {
      case 'key': case 'digest': case 'namespace':
        if (typeof descriptor.value !== 'string') return false
        break
      case 'schemaVersion': case 'facts':
        if (typeof descriptor.value !== 'number') return false
        break
      case 'capabilities':
        if (descriptor.value !== undefined && !immutableScalarArray(descriptor.value)) return false
        break
      default: return false
    }
  }
  return true
}

function immutableScalarArray(value: unknown): boolean {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== ARRAY_PROTOTYPE || !Object.isFrozen(value)) return false
  // Dense own data elements only: holes, accessors and custom map/constructor/
  // toJSON properties could observe canonicalization or change its result.
  if (Reflect.ownKeys(value).length !== value.length + 1) return false
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor)) return false
    const entry: unknown = descriptor.value
    // Bigint canonicalization calls a replaceable toString method.
    if (entry !== null && (typeof entry === 'object' || typeof entry === 'function' ||
      typeof entry === 'bigint')) return false
  }
  return true
}

function ordinaryArrayIntrinsics(): boolean {
  // canonical() calls array.map(), which also observes constructor/species.
  // Inspect descriptors without invoking accessors, even for cached references.
  // A changed prototype can also add toJSON to the freshly canonicalized arrays.
  if (!NATIVE_ARRAY_MAPPING || Array !== ARRAY || Array.prototype !== ARRAY_PROTOTYPE ||
    Object.getPrototypeOf(ARRAY_PROTOTYPE) !== Object.prototype ||
    Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'toJSON') !== undefined ||
    Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') !== undefined ||
    !sameDescriptor(Object.getOwnPropertyDescriptor(ARRAY, Symbol.species), ARRAY_SPECIES) ||
    Reflect.ownKeys(ARRAY_PROTOTYPE).length !== ARRAY_KEYS.length) return false
  for (let index = 0; index < ARRAY_KEYS.length; index++) {
    const key = ARRAY_KEYS[index]!
    if (!sameDescriptor(Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, key),
      Reflect.get(ARRAY_DESCRIPTORS, key) as PropertyDescriptor)) return false
  }
  return true
}

function nativeFunction(value: unknown, name: string): boolean {
  return typeof value === 'function' && !types.isProxy(value) &&
    Function.prototype.toString.call(value).replace(/\s+/gu, ' ').trim() === `function ${name}() { [native code] }`
}

function sameDescriptor(left: PropertyDescriptor | undefined, right: PropertyDescriptor | undefined): boolean {
  return left !== undefined && right !== undefined && left.value === right.value &&
    left.get === right.get && left.set === right.set && left.writable === right.writable &&
    left.enumerable === right.enumerable && left.configurable === right.configurable
}

function flatRecord(value: unknown): value is object {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!('value' in descriptor)) return false
    const entry: unknown = descriptor.value
    if (entry !== null && (typeof entry === 'object' || typeof entry === 'function')) return false
  }
  return true
}
