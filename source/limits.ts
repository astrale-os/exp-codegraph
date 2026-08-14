export const MAX_VALUE_DEPTH = 100
export const MAX_VALUE_NODES = 10_000

export type ValueLimit = 'depth' | 'size'

export function valueLimit(value: unknown): ValueLimit | undefined {
  let nodes = 0
  const stack: [unknown, number][] = [[value, 0]]

  while (stack.length) {
    const [current, depth] = stack.pop()!
    if (depth > MAX_VALUE_DEPTH) return 'depth'
    if (++nodes > MAX_VALUE_NODES) return 'size'

    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) {
        stack.push([current[index], depth + 1])
      }
    } else if (current && typeof current === 'object') {
      for (const child of Object.values(current)) stack.push([child, depth + 1])
    }
  }
  return undefined
}
