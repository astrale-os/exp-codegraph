import { types } from 'node:util'
import { shardReference, type FactShard, type FactShardReference } from '../facts/index.ts'
import type { FactTransaction } from '../generation/index.ts'
import { stableJson } from '../identity/model.ts'

const FLAT_SHARDS = new WeakSet<FactShard>()
const FLAT_REFERENCES = new WeakSet<FactShardReference>()
const ARRAY_MAP = Array.prototype.map
const ARRAY_CONSTRUCTOR = Array.prototype.constructor
const REFERENCE_KEYS = new Set(['key', 'digest', 'namespace', 'schemaVersion', 'facts', 'capabilities'])

/** Compare the complete manifest without constructing and canonicalizing a second population. */
export function matchesMaterializedManifest(shards: ReadonlyMap<string, FactShard>, transaction: Pick<FactTransaction, 'manifest'>): boolean {
  const original = () => {
    const actual = [...shards.values()].map(shardReference).sort((left, right) => left.key.localeCompare(right.key))
    return stableJson(actual) === stableJson(transaction.manifest)
  }
  if ('toJSON' in Object.prototype || 'toJSON' in Array.prototype) return original()
  // Preflight reads descriptors only. A custom accessor/proxy keeps the complete
  // old observation sequence, including actual-shard getters before the manifest.
  if (types.isProxy(transaction)) return original()
  const manifestField = Object.getOwnPropertyDescriptor(transaction, 'manifest')
  if (!manifestField || !('value' in manifestField) || !plainArray(manifestField.value)) return original()
  const manifest = manifestField.value as readonly FactShardReference[]
  for (const [key, shard] of shards) {
    if (!flatShard(shard) || shard.key !== key) return original()
  }
  let matches = manifest.length === shards.size
  let previous: string | undefined
  for (let index = 0; index < manifest.length; index++) {
    const field = Object.getOwnPropertyDescriptor(manifest, index)
    if (!field || !('value' in field) || !flatReference(field.value)) return original()
    const reference = field.value as FactShardReference
    // Validation can call custom payload getters. Recheck membership order at
    // this boundary in case one changed otherwise plain manifest data meanwhile.
    if (previous !== undefined && reference.key.localeCompare(previous) <= 0) matches = false
    previous = reference.key
    const shard = shards.get(reference.key)
    if (!shard || reference.digest !== shard.digest || reference.namespace !== shard.namespace ||
      reference.schemaVersion !== shard.schemaVersion || reference.facts !== shard.facts.length ||
      !sameCapabilities(reference.capabilities, shard.capabilities)) matches = false
  }
  return matches
}

function flatShard(shard: FactShard): boolean {
  if (FLAT_SHARDS.has(shard)) return ownedOptionalCapabilities(shard)
  if (!plainRecord(shard)) return false
  for (const [key, type] of [['key', 'string'], ['digest', 'string'], ['namespace', 'string'], ['schemaVersion', 'number']] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(shard, key)
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== type ||
      type === 'number' && !Number.isFinite(descriptor.value)) return false
  }
  const facts = Object.getOwnPropertyDescriptor(shard, 'facts')
  const capabilities = Object.getOwnPropertyDescriptor(shard, 'capabilities')
  if (!facts || !('value' in facts) || !Array.isArray(facts.value) || types.isProxy(facts.value) ||
    capabilities && (!('value' in capabilities) || capabilities.value !== undefined && !stringArray(capabilities.value))) return false
  // Inherited fields would be read by shardReference but are not owned data.
  if (!capabilities && 'capabilities' in shard) return false
  if (Object.isFrozen(shard) && Object.isFrozen(facts.value) &&
    (!capabilities || capabilities.value === undefined || Object.isFrozen(capabilities.value))) {
    FLAT_SHARDS.add(shard)
  }
  return true
}

function flatReference(value: unknown): value is FactShardReference {
  if (!value || typeof value !== 'object') return false
  if (FLAT_REFERENCES.has(value as FactShardReference)) return ownedOptionalCapabilities(value)
  if (!plainRecord(value)) return false
  for (const key of Object.keys(value)) if (!REFERENCE_KEYS.has(key)) return false
  for (const [key, type] of [['key', 'string'], ['digest', 'string'], ['namespace', 'string'], ['schemaVersion', 'number'], ['facts', 'number']] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== type ||
      type === 'number' && !Number.isFinite(descriptor.value)) return false
  }
  const capabilities = Object.getOwnPropertyDescriptor(value, 'capabilities')
  if (capabilities && (!capabilities.enumerable || !('value' in capabilities) ||
    capabilities.value !== undefined && !stringArray(capabilities.value))) return false
  if (!capabilities && 'capabilities' in value) return false
  if (Object.isFrozen(value) && (!capabilities || capabilities.value === undefined || Object.isFrozen(capabilities.value))) {
    FLAT_REFERENCES.add(value as FactShardReference)
  }
  return true
}

function sameCapabilities(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

function ownedOptionalCapabilities(value: object): boolean {
  // Freezing owns existing fields, not the future state of Object.prototype.
  // A previously absent optional field must not silently become an inherited
  // value/getter on reuse of the shape certificate.
  return Object.hasOwn(value, 'capabilities') || !('capabilities' in value)
}

function plainRecord(value: unknown): value is object {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function plainArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Array.prototype &&
    !Object.hasOwn(value, 'map') && !Object.hasOwn(value, 'constructor') &&
    Array.prototype.map === ARRAY_MAP && Array.prototype.constructor === ARRAY_CONSTRUCTOR
}

function stringArray(value: unknown): value is readonly string[] {
  if (!plainArray(value)) return false
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') return false
  }
  return true
}
