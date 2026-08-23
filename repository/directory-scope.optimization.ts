const GLOB_META = /[?*\[\]{}]/u

/** Resolve the common literal recursive-directory glob forms without compiling a matcher. */
export function simpleDirectoryExclusion(
  path: string,
  normalizedPattern: string,
): boolean | undefined {
  if (!GLOB_META.test(normalizedPattern)) {
    return path === normalizedPattern || path.startsWith(`${normalizedPattern}/`)
  }
  if (!normalizedPattern.endsWith('/**')) return
  const base = normalizedPattern.slice(0, -'/**'.length)
  if (!base.startsWith('**/') && !GLOB_META.test(base)) {
    return path === base || path.startsWith(`${base}/`)
  }
  if (!base.startsWith('**/')) return
  const segment = base.slice('**/'.length)
  if (!segment || GLOB_META.test(segment)) return
  return (
    path === segment ||
    path.startsWith(`${segment}/`) ||
    path.endsWith(`/${segment}`) ||
    path.includes(`/${segment}/`)
  )
}

/** Match the same common recursive forms for a concrete repository file path. */
export function simpleRepositoryPathMatch(
  path: string,
  normalizedPattern: string,
): boolean | undefined {
  if (!GLOB_META.test(normalizedPattern)) return path === normalizedPattern
  if (!normalizedPattern.endsWith('/**')) return
  const base = normalizedPattern.slice(0, -'/**'.length)
  if (!base.startsWith('**/') && !GLOB_META.test(base)) {
    return path.startsWith(`${base}/`)
  }
  if (!base.startsWith('**/')) return
  const segment = base.slice('**/'.length)
  if (!segment || GLOB_META.test(segment)) return
  return path.startsWith(`${segment}/`) || path.includes(`/${segment}/`)
}
