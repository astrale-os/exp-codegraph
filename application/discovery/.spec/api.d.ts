export interface ApplicationDiscoveryOptions {
  readonly exclude?: readonly string[]
}

export function resolveApplicationRoot(input: string): Promise<string>

export function discoverSpecificationDirectories(
  directory: string,
  options?: ApplicationDiscoveryOptions,
): Promise<string[]>
