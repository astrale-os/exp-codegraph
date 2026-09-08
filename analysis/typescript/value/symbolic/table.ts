type Leaf<Key, Value> = { readonly kind: 'leaf'; readonly hash: number; readonly key: Key; readonly value: Value }
type Collision<Key, Value> = { readonly kind: 'collision'; readonly hash: number; readonly values: ReadonlyMap<Key, Value> }
type Branch<Key, Value> = {
  readonly kind: 'branch'
  bitmap: number
  children: Node<Key, Value>[]
  /** At most 32 slot characters preserve the original branch traversal order. */
  order: string
}
type Node<Key, Value> = Leaf<Key, Value> | Collision<Key, Value> | Branch<Key, Value>

/** Immutable lookup tables share untouched hash-trie branches between pinned revisions. */
export class ValueIndexTable<Key extends string, Value> implements ReadonlyMap<Key, Value> {
  readonly #root: Node<Key, Value> | undefined
  readonly size: number
  readonly [Symbol.toStringTag] = 'ValueIndexTable'

  constructor(root?: Node<Key, Value>, size = 0) { this.#root = root; this.size = size }

  get(key: Key): Value | undefined {
    if (!this.#root) return undefined
    const hash = hashKey(key)
    let node: Node<Key, Value> | undefined = this.#root
    let shift = 0
    while (node?.kind === 'branch') {
      const bit = 1 << ((hash >>> shift) & 31)
      if (!(node.bitmap & bit)) return undefined
      node = node.children[position(node.bitmap, bit)]
      shift += 5
    }
    return node?.kind === 'leaf' ? node.key === key ? node.value : undefined : node?.values.get(key)
  }

  has(key: Key): boolean {
    if (!this.#root) return false
    const hash = hashKey(key)
    let node: Node<Key, Value> | undefined = this.#root
    let shift = 0
    while (node?.kind === 'branch') {
      const bit = 1 << ((hash >>> shift) & 31)
      if (!(node.bitmap & bit)) return false
      node = node.children[position(node.bitmap, bit)]
      shift += 5
    }
    return node?.kind === 'leaf' ? node.key === key : node?.values.has(key) ?? false
  }

  edit(): ValueIndexTableEdit<Key, Value> { return new ValueIndexTableEdit(this.#root, this.size) }
  *entries(): MapIterator<[Key, Value]> { yield* entries(this.#root) }
  *keys(): MapIterator<Key> { for (const [key] of this) yield key }
  *values(): MapIterator<Value> { for (const [, value] of this) yield value }
  [Symbol.iterator](): MapIterator<[Key, Value]> { return this.entries() }
  forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown): void {
    for (const [key, value] of this) callback.call(thisArg, value, key, this)
  }
}

/** One update copies each modified branch once, even when many facts share its prefix. */
export class ValueIndexTableEdit<Key extends string, Value> {
  #root: Node<Key, Value> | undefined
  #size: number
  readonly #owned = new WeakSet<object>()
  #finished = false

  constructor(root: Node<Key, Value> | undefined, size: number) { this.#root = root; this.#size = size }

  get(key: Key): Value | undefined {
    if (!this.#root) return undefined
    const hash = hashKey(key)
    let node: Node<Key, Value> | undefined = this.#root
    let shift = 0
    while (node?.kind === 'branch') {
      const bit = 1 << ((hash >>> shift) & 31)
      if (!(node.bitmap & bit)) return undefined
      node = node.children[position(node.bitmap, bit)]
      shift += 5
    }
    return node?.kind === 'leaf' ? node.key === key ? node.value : undefined : node?.values.get(key)
  }

  set(key: Key, value: Value): void {
    if (this.#finished) throw new Error('Value index update is already published.')
    this.#root = this.write(this.#root, hashKey(key), key, value, 0)
  }

  delete(key: Key): void {
    if (this.#finished) throw new Error('Value index update is already published.')
    this.#root = this.remove(this.#root, hashKey(key), key, 0)
  }

  finish(): ValueIndexTable<Key, Value> {
    this.#finished = true
    return new ValueIndexTable(this.#root, this.#size)
  }

  private branch(node: Branch<Key, Value>): Branch<Key, Value> {
    if (this.#owned.has(node)) return node
    const branch: Branch<Key, Value> = { kind: 'branch', bitmap: node.bitmap, children: node.children.slice(), order: node.order }
    this.#owned.add(branch)
    return branch
  }

  private write(node: Node<Key, Value> | undefined, hash: number, key: Key, value: Value, shift: number): Node<Key, Value> {
    if (!node) { this.#size++; return { kind: 'leaf', hash, key, value } }
    if (node.kind === 'branch') {
      const part = (hash >>> shift) & 31
      const bit = 1 << part
      const branch = this.branch(node)
      const index = position(branch.bitmap, bit)
      if (branch.bitmap & bit) branch.children[index] = this.write(branch.children[index], hash, key, value, shift + 5)
      else {
        const child = this.write(undefined, hash, key, value, shift + 5)
        // concat allocates exactly one additional slot; growing a sparse branch
        // with splice otherwise reserves a much larger backing array in V8.
        const children = branch.children.concat(child)
        for (let offset = children.length - 1; offset > index; offset--) children[offset] = children[offset - 1]!
        children[index] = child
        branch.children = children
        branch.bitmap |= bit
        branch.order += String.fromCharCode(part)
      }
      return branch
    }
    if (node.kind === 'leaf' && node.key === key) return { kind: 'leaf', hash, key, value }
    if (node.hash === hash) {
      const values = node.kind === 'leaf' ? new Map([[node.key, node.value]]) : new Map(node.values)
      if (!values.has(key)) this.#size++
      values.set(key, value)
      return { kind: 'collision', hash, values }
    }
    const part = (node.hash >>> shift) & 31
    const branch: Branch<Key, Value> = { kind: 'branch', bitmap: 1 << part, children: [node], order: String.fromCharCode(part) }
    this.#owned.add(branch)
    return this.write(branch, hash, key, value, shift)
  }

  private remove(node: Node<Key, Value> | undefined, hash: number, key: Key, shift: number): Node<Key, Value> | undefined {
    if (!node) return
    if (node.kind === 'branch') {
      const part = (hash >>> shift) & 31
      const bit = 1 << part
      if (!(node.bitmap & bit)) return node
      const index = position(node.bitmap, bit)
      const previous = node.children[index]
      const next = this.remove(previous, hash, key, shift + 5)
      if (next === previous) return node
      const branch = this.branch(node)
      if (next) branch.children[index] = next
      else {
        branch.children.splice(index, 1)
        branch.bitmap &= ~bit
        const ordinal = branch.order.indexOf(String.fromCharCode(part))
        branch.order = branch.order.slice(0, ordinal) + branch.order.slice(ordinal + 1)
      }
      if (!branch.children.length) return
      if (branch.children.length === 1) {
        const only = branch.children[0]!
        if (only.kind !== 'branch') return only
      }
      return branch
    }
    if (node.kind === 'leaf') {
      if (node.key !== key) return node
      this.#size--
      return
    }
    if (!node.values.has(key)) return node
    const values = new Map(node.values)
    values.delete(key)
    this.#size--
    if (values.size === 1) {
      const [remaining, value] = values.entries().next().value!
      return { kind: 'leaf', hash: node.hash, key: remaining, value }
    }
    return { kind: 'collision', hash: node.hash, values }
  }
}

function* entries<Key, Value>(node: Node<Key, Value> | undefined): MapIterator<[Key, Value]> {
  if (node?.kind === 'leaf') yield [node.key, node.value]
  else if (node?.kind === 'collision') yield* node.values
  else if (node) for (let index = 0; index < node.order.length; index++)
    yield* entries(node.children[position(node.bitmap, 1 << node.order.charCodeAt(index))])
}

function position(bitmap: number, bit: number): number {
  let before = bitmap & (bit - 1)
  before -= (before >>> 1) & 0x55555555
  before = (before & 0x33333333) + ((before >>> 2) & 0x33333333)
  return Math.imul((before + (before >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

function hashKey(value: string): number {
  // Analysis coordinates already contain a uniformly distributed SHA-256 suffix.
  // Rehashing every character at each lookup wasted most of the trie traversal time.
  // Full keys remain in leaves and collision buckets, so this never establishes identity.
  if (value.charCodeAt(value.length - 65) === 58) {
    let digest = 0
    let index = value.length - 8
    for (; index < value.length; index++) {
      const code = value.charCodeAt(index)
      const lower = code | 32
      const digit = code >= 48 && code <= 57 ? code - 48 : lower >= 97 && lower <= 102 ? lower - 87 : -1
      if (digit < 0) break
      digest = (digest << 4) | digit
    }
    if (index === value.length) return digest >>> 0
    // Preserve routing and traversal for arbitrary strings, including the partial
    // or signed hexadecimal spellings accepted by the original parseInt path.
    const partial = Number.parseInt(value.slice(-8), 16)
    if (Number.isFinite(partial)) return partial >>> 0
  }
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  return hash >>> 0
}
