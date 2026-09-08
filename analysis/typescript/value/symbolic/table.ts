type Leaf<Key, Value> = { readonly kind: 'leaf'; readonly hash: number; readonly key: Key; readonly value: Value }
type Collision<Key, Value> = { readonly kind: 'collision'; readonly hash: number; readonly values: ReadonlyMap<Key, Value> }
type Branch<Key, Value> = { readonly kind: 'branch'; readonly children: ReadonlyMap<number, Node<Key, Value>> }
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
    while (node?.kind === 'branch') { node = node.children.get((hash >>> shift) & 31); shift += 5 }
    return node?.kind === 'leaf' ? node.key === key ? node.value : undefined : node?.values.get(key)
  }

  has(key: Key): boolean {
    if (!this.#root) return false
    const hash = hashKey(key)
    let node: Node<Key, Value> | undefined = this.#root
    let shift = 0
    while (node?.kind === 'branch') { node = node.children.get((hash >>> shift) & 31); shift += 5 }
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
    while (node?.kind === 'branch') { node = node.children.get((hash >>> shift) & 31); shift += 5 }
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

  private branch(node: Branch<Key, Value>): Map<number, Node<Key, Value>> {
    if (this.#owned.has(node.children)) return node.children as Map<number, Node<Key, Value>>
    const children = new Map(node.children)
    this.#owned.add(children)
    return children
  }

  private write(node: Node<Key, Value> | undefined, hash: number, key: Key, value: Value, shift: number): Node<Key, Value> {
    if (!node) { this.#size++; return { kind: 'leaf', hash, key, value } }
    if (node.kind === 'branch') {
      const position = (hash >>> shift) & 31
      const children = this.branch(node)
      children.set(position, this.write(children.get(position), hash, key, value, shift + 5))
      return children === node.children ? node : { kind: 'branch', children }
    }
    if (node.kind === 'leaf' && node.key === key) return { kind: 'leaf', hash, key, value }
    if (node.hash === hash) {
      const values = node.kind === 'leaf' ? new Map([[node.key, node.value]]) : new Map(node.values)
      if (!values.has(key)) this.#size++
      values.set(key, value)
      return { kind: 'collision', hash, values }
    }
    const position = (node.hash >>> shift) & 31
    const children = new Map([[position, node]])
    this.#owned.add(children)
    return this.write({ kind: 'branch', children }, hash, key, value, shift)
  }

  private remove(node: Node<Key, Value> | undefined, hash: number, key: Key, shift: number): Node<Key, Value> | undefined {
    if (!node) return
    if (node.kind === 'branch') {
      const position = (hash >>> shift) & 31
      const previous = node.children.get(position)
      const next = this.remove(previous, hash, key, shift + 5)
      if (next === previous) return node
      const children = this.branch(node)
      if (next) children.set(position, next)
      else children.delete(position)
      if (!children.size) return
      if (children.size === 1) {
        const only = children.values().next().value!
        if (only.kind !== 'branch') return only
      }
      return children === node.children ? node : { kind: 'branch', children }
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
  else if (node) for (const child of node.children.values()) yield* entries(child)
}

function hashKey(value: string): number {
  // Analysis coordinates already contain a uniformly distributed SHA-256 suffix.
  // Rehashing every character at each lookup wasted most of the trie traversal time.
  // Full keys remain in leaves and collision buckets, so this never establishes identity.
  if (value.charCodeAt(value.length - 65) === 58) {
    const digest = Number.parseInt(value.slice(-8), 16)
    if (Number.isFinite(digest)) return digest >>> 0
  }
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  return hash >>> 0
}
