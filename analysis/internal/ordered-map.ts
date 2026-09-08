interface Node<Value> {
  readonly key: string
  readonly value: Value
  readonly left: Node<Value> | undefined
  readonly right: Node<Value> | undefined
  readonly height: number
  readonly size: number
}

/** Ordered snapshot data: updates share untouched branches and never retain a previous root. */
export class OrderedMap<Value> {
  readonly #root: Node<Value> | undefined
  constructor(root?: Node<Value>) { this.#root = root }
  get size(): number { return this.#root?.size ?? 0 }

  static fromSorted<Value>(entries: readonly (readonly [string, Value])[]): OrderedMap<Value> {
    const build = (start: number, end: number): Node<Value> | undefined => {
      if (start === end) return
      const middle = (start + end) >>> 1
      const [key, value] = entries[middle]!
      return node(key, value, build(start, middle), build(middle + 1, end))
    }
    return new OrderedMap(build(0, entries.length))
  }

  get(key: string): Value | undefined {
    let current = this.#root
    while (current) {
      const order = compareKeys(key, current.key)
      if (!order) return current.value
      current = order < 0 ? current.left : current.right
    }
    return undefined
  }

  set(key: string, value: Value): OrderedMap<Value> {
    const write = (current: Node<Value> | undefined): Node<Value> => {
      if (!current) return node(key, value)
      const order = compareKeys(key, current.key)
      if (!order) return Object.is(current.value, value) ? current : node(key, value, current.left, current.right)
      const next = order < 0 ? write(current.left) : write(current.right)
      if (next === (order < 0 ? current.left : current.right)) return current
      return balance(order < 0 ? node(current.key, current.value, next, current.right)
        : node(current.key, current.value, current.left, next))
    }
    const next = write(this.#root)
    return next === this.#root ? this : new OrderedMap(next)
  }

  delete(key: string): OrderedMap<Value> {
    const remove = (current: Node<Value> | undefined): Node<Value> | undefined => {
      if (!current) return
      const order = compareKeys(key, current.key)
      if (!order) {
        if (!current.left) return current.right
        if (!current.right) return current.left
        let successor = current.right
        while (successor.left) successor = successor.left
        return balance(node(successor.key, successor.value, current.left, removeFirst(current.right)))
      }
      const next = order < 0 ? remove(current.left) : remove(current.right)
      if (next === (order < 0 ? current.left : current.right)) return current
      return balance(order < 0 ? node(current.key, current.value, next, current.right)
        : node(current.key, current.value, current.left, next))
    }
    const next = remove(this.#root)
    return next === this.#root ? this : new OrderedMap(next)
  }

  *entries(): IterableIterator<readonly [string, Value]> {
    // An explicit traversal stack avoids one suspended generator per tree node.
    const pending: Node<Value>[] = []
    let current = this.#root
    while (current || pending.length) {
      while (current) { pending.push(current); current = current.left }
      const next = pending.pop()!
      yield [next.key, next.value]
      current = next.right
    }
  }
  *values(): IterableIterator<Value> { for (const [, value] of this) yield value }
  [Symbol.iterator](): IterableIterator<readonly [string, Value]> { return this.entries() }
}

export function compareKeys(left: string, right: string): number {
  if (left === right) return 0
  // Locale-equivalent strings remain different keys (e.g. composed accents).
  return left.localeCompare(right) || (left < right ? -1 : 1)
}

function node<Value>(key: string, value: Value, left?: Node<Value>, right?: Node<Value>): Node<Value> {
  return { key, value, left, right, height: Math.max(left?.height ?? 0, right?.height ?? 0) + 1,
    size: (left?.size ?? 0) + (right?.size ?? 0) + 1 }
}

function balance<Value>(current: Node<Value>): Node<Value> {
  const difference = (current.left?.height ?? 0) - (current.right?.height ?? 0)
  if (difference > 1) {
    let left = current.left!
    if ((left.left?.height ?? 0) < (left.right?.height ?? 0)) left = rotateLeft(left)
    return rotateRight(node(current.key, current.value, left, current.right))
  }
  if (difference < -1) {
    let right = current.right!
    if ((right.right?.height ?? 0) < (right.left?.height ?? 0)) right = rotateRight(right)
    return rotateLeft(node(current.key, current.value, current.left, right))
  }
  return current
}
function rotateLeft<Value>(current: Node<Value>): Node<Value> {
  const right = current.right!
  return node(right.key, right.value, node(current.key, current.value, current.left, right.left), right.right)
}
function rotateRight<Value>(current: Node<Value>): Node<Value> {
  const left = current.left!
  return node(left.key, left.value, left.left, node(current.key, current.value, left.right, current.right))
}
function removeFirst<Value>(current: Node<Value>): Node<Value> | undefined {
  if (!current.left) return current.right
  return balance(node(current.key, current.value, removeFirst(current.left), current.right))
}
