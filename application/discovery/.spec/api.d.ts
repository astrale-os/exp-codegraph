export interface ApplicationDiscoveryOptions {
  readonly exclude?: readonly string[]
}

export function resolveApplicationRoot(input: string): Promise<string>

export function discoverSpecificationDirectories(
  directory: string,
  options?: ApplicationDiscoveryOptions,
): Promise<string[]>

/** Generated, dependency, and VCS trees excluded from application-owned repository inventories. */
export const APPLICATION_REPOSITORY_EXCLUDES: readonly string[]
