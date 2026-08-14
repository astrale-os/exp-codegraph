export function freeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  const pending: object[] = [value]
  const seen = new WeakSet<object>()
  while (pending.length) {
    const current = pending.pop()
    if (!current || seen.has(current)) continue
    seen.add(current)
    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') pending.push(child)
    }
    Object.freeze(current)
  }
  return value
}
