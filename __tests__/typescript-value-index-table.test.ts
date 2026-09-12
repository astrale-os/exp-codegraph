import { describe, expect, it } from 'vitest'
import { ValueIndexTable } from '../analysis/typescript/value/symbolic/table.ts'

const coordinate = (name: string, suffix: string) => `${name}:${'0'.repeat(56)}${suffix}`

describe('immutable value lookup tables', () => {
  it('preserves branch insertion order through collisions, collapse and reinsertion', () => {
    const [a, b, c, d, e] = [
      coordinate('a', '0000001f'), coordinate('b', '00000000'), coordinate('c', '00000005'),
      coordinate('d', '0000003f'), coordinate('e', '0000001f'),
    ] as [string, string, string, string, string]
    const build = new ValueIndexTable<string, string>().edit()
    for (const key of [a, b, c, d, e]) build.set(key, key)
    const pinned = build.finish()
    expect([...pinned.keys()]).toEqual([a, e, d, b, c])
    const edit = pinned.edit()
    edit.delete(a)
    edit.delete(e)
    edit.delete(d)
    edit.set(a, 'reinserted')
    const changed = edit.finish()
    expect([...changed]).toEqual([[b, b], [c, c], [a, 'reinserted']])
    expect([...pinned.keys()]).toEqual([a, e, d, b, c])
    expect([...changed.values()]).toEqual([b, c, 'reinserted'])
    const receiver: [string, string][] = []
    changed.forEach(function (this: typeof receiver, value, key, table) {
      expect(table).toBe(changed)
      this.push([key, value])
    }, receiver)
    expect(receiver).toEqual([...changed])
  })

  it('keeps full string identity and stored undefined values across every digest spelling', () => {
    const keys = [
      '', '__proto__', 'constructor', '\0', '\ud800', 'é:☃',
      ...['deadbeef', 'DEADBEEF', '00000000', '80000000', 'ffffffff', '1x------',
        '0x123456', '+0000001', '-0000001', '  000001', '@bad00ff', '`bad00ff', 'zzzzzzzz']
        .flatMap(suffix => [coordinate('one', suffix), coordinate('two', suffix)]),
    ]
    const build = new ValueIndexTable<string, number | undefined>().edit()
    const oracle = new Map(keys.map((key, index) => [key, index % 3 ? index : undefined]))
    for (const [key, value] of oracle) build.set(key, value)
    const pinned = build.finish()
    expect(pinned.size).toBe(oracle.size)
    for (const [key, value] of oracle) {
      expect(pinned.has(key)).toBe(true)
      expect(pinned.get(key)).toBe(value)
      expect(pinned.has(`missing:${key}`)).toBe(false)
    }
    const edit = pinned.edit()
    for (const key of keys) edit.delete(key)
    const empty = edit.finish()
    expect(empty.size).toBe(0)
    expect([...empty]).toEqual([])
    expect(pinned.size).toBe(oracle.size)
    expect(pinned.has('')).toBe(true)
    expect(pinned.get('')).toBeUndefined()
  })

  it('retains independently edited roots and rejects writes after publication', () => {
    const base = new ValueIndexTable<string, object | undefined>()
    const low = coordinate('low', '00000000')
    const high = coordinate('high', '80000000')
    const atom = Object.freeze({ opaque: true })
    const build = base.edit()
    build.set(low, undefined)
    build.set(high, atom)
    const pinned = build.finish()
    const left = pinned.edit()
    const right = pinned.edit()
    left.delete(high)
    right.delete(low)
    right.set(high, undefined)
    const leftTable = left.finish()
    const rightTable = right.finish()
    expect(leftTable.size).toBe(1)
    expect(leftTable.has(low)).toBe(true)
    expect(leftTable.has(high)).toBe(false)
    expect(rightTable.has(low)).toBe(false)
    expect(rightTable.has(high)).toBe(true)
    expect(pinned.get(high)).toBe(atom)
    expect(pinned.has(low)).toBe(true)
    expect(base.size).toBe(0)
    expect(() => left.set(low, atom)).toThrow('already published')
    expect(() => right.delete(high)).toThrow('already published')
    expect(build.get(high)).toBe(atom)
    expect([...build.finish()]).toEqual([...pinned])
  })

  it('preserves first-seen slots through seven levels, full hash collisions and replacements', () => {
    const [a, b, c, d, collision, other] = [
      coordinate('a', '80000000'), coordinate('b', '00000000'),
      coordinate('c', 'c0000000'), coordinate('d', '40000000'),
      coordinate('collision', '00000000'), coordinate('other', '00000001'),
    ] as const
    const atom = Object.freeze({ value: 'replacement' })
    const build = new ValueIndexTable<string, object | undefined>().edit()
    for (const key of [a, other, b, c, collision, d]) build.set(key, undefined)
    build.set(b, atom)
    expect(build.get(b)).toBe(atom)
    expect(build.get(collision)).toBeUndefined()
    const pinned = build.finish()
    expect([...pinned.keys()]).toEqual([a, b, collision, c, d, other])
    expect(pinned.size).toBe(6)
    expect(pinned.has(collision)).toBe(true)
    expect(build.get(b)).toBe(atom)
    expect([...build.finish()]).toEqual([...pinned])
    expect(() => build.set(b, undefined)).toThrow('already published')
    expect(() => build.delete('absent')).toThrow('already published')

    const left = pinned.edit(), right = pinned.edit()
    left.delete(a)
    left.set(a, atom)
    right.delete(b)
    right.set(collision, atom)
    expect([...left.finish().keys()]).toEqual([b, collision, c, d, a, other])
    expect([...right.finish().keys()]).toEqual([a, collision, c, d, other])
    expect(pinned.get(collision)).toBeUndefined()
    expect(pinned.get(b)).toBe(atom)
    expect([...pinned.keys()]).toEqual([a, b, collision, c, d, other])
  })

  it('keeps a surviving slot in place when its first key is deleted before publication', () => {
    const a = coordinate('first', '00000000')
    const b = coordinate('second', '00000001')
    const c = coordinate('survivor', '00000020')
    const build = new ValueIndexTable<string, string | undefined>().edit()
    build.set(a, undefined)
    build.set(b, 'second')
    build.set(c, 'survivor')
    build.delete('absent')
    build.delete(a)
    expect(build.get(a)).toBeUndefined()
    expect(build.get(c)).toBe('survivor')
    const pinned = build.finish()
    // Filtering the original insertion Map would incorrectly visit b before c.
    expect([...pinned.keys()]).toEqual([c, b])
    expect(pinned.has(a)).toBe(false)
    const changed = pinned.edit()
    changed.set(a, 'returned')
    expect([...changed.finish().keys()]).toEqual([c, a, b])
    expect([...pinned.keys()]).toEqual([c, b])
  })

  it('matches incremental construction through mixed edits before the first publication', () => {
    const sentinel = coordinate('sentinel', 'ffffffff')
    const seed = new ValueIndexTable<string, number | undefined>().edit()
    seed.set(sentinel, 0)
    const pinned = seed.finish()
    const incremental = pinned.edit()
    const bulk = new ValueIndexTable<string, number | undefined>().edit()
    // Slot 31 is reserved for the sentinel. Removing it after the operations
    // leaves exactly the traversal established by the shared insertions.
    const keys = Array.from({ length: 96 }, (_, index) => coordinate(String(index),
      (((Math.imul(index % 24, 0x9e3779b1) & 0xffffffe0) | index % 8) >>> 0).toString(16).padStart(8, '0')))
    for (const [index, key] of keys.entries()) {
      bulk.set(key, index % 3 ? index : undefined)
      incremental.set(key, index % 3 ? index : undefined)
    }
    for (let index = 0; index < keys.length; index++) {
      const key = keys[(index * 17) % keys.length]!
      if (index % 4 === 0) { bulk.delete(key); incremental.delete(key) }
      else { bulk.set(key, index); incremental.set(key, index) }
      expect(bulk.get(key)).toBe(incremental.get(key))
    }
    incremental.delete(sentinel)
    const actual = bulk.finish(), expected = incremental.finish()
    expect([...actual]).toEqual([...expected])
    expect(actual.size).toBe(expected.size)
    expect([...pinned]).toEqual([[sentinel, 0]])
    expect([...bulk.finish()]).toEqual([...expected])
    const emptied = actual.edit()
    for (const key of actual.keys()) emptied.delete(key)
    const empty = emptied.finish()
    const restarted = empty.edit()
    restarted.delete('absent')
    restarted.set(keys[0]!, undefined)
    expect(restarted.finish().has(keys[0]!)).toBe(true)
    expect(empty.size).toBe(0)
    expect([...actual]).toEqual([...expected])
  })

  it('matches exact key/value membership through many pinned mixed revisions', () => {
    const keys = Array.from({ length: 256 }, (_, index) => index % 4
      ? coordinate(String(index), ((Math.imul(index, 0x9e3779b1)) >>> 0).toString(16).padStart(8, '0'))
      : coordinate(String(index), 'deadbeef'))
    let table = new ValueIndexTable<string, number | undefined>()
    const oracle = new Map<string, number | undefined>()
    const history: { table: typeof table; oracle: typeof oracle }[] = []
    let state = 0x12345678
    for (let revision = 0; revision < 24; revision++) {
      const edit = table.edit()
      for (let operation = 0; operation < 96; operation++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5
        const key = keys[(state >>> 0) % keys.length]!
        if (state & 1) { edit.delete(key); oracle.delete(key) }
        else {
          const value = state & 2 ? undefined : revision
          edit.set(key, value); oracle.set(key, value)
          expect(edit.get(key)).toBe(value)
        }
      }
      table = edit.finish()
      history.push({ table, oracle: new Map(oracle) })
    }
    for (const { table: pinned, oracle: expected } of history) {
      expect(pinned.size).toBe(expected.size)
      expect([...pinned].sort()).toEqual([...expected].sort())
      for (const key of keys) {
        expect(pinned.has(key)).toBe(expected.has(key))
        expect(pinned.get(key)).toBe(expected.get(key))
      }
    }
  })
})
