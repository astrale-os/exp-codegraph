export type CodegraphWorkerRole =
  | 'api-compiler'
  | 'application-binding'
  | 'specification-typescript'

export interface CodegraphWorkerProcess {
  readonly executable: string
  readonly arguments: readonly string[]
}

/** Build the bounded Node invocation and retain a stable operator-visible worker role. */
export function codegraphWorkerProcess(
  role: CodegraphWorkerRole,
  worker: string,
  maxOldSpaceMegabytes: number,
  trailingArguments: readonly string[] = [],
): CodegraphWorkerProcess {
  return {
    executable: process.execPath,
    arguments: [
      `--max-old-space-size=${maxOldSpaceMegabytes}`,
      worker,
      `--codegraph-worker=${role}`,
      ...trailingArguments,
    ],
  }
}
