export interface BenchmarkDefinition<Id extends string = string> {
  readonly id: Id
  readonly statement: string
  readonly workload: string
  readonly metrics: readonly string[]
  readonly capability?: string
  readonly assumptions?: readonly string[]
}

/** Preserve one stable benchmark scenario without executing the workload. */
export function defineBenchmark<const Definition extends BenchmarkDefinition>(
  definition: Definition,
): Definition {
  return definition
}
