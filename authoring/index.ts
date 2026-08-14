export type { TestEvidenceReference } from './evidence.ts'

export { defineCode } from './code.ts'
export type { CodeConfiguration } from './code.ts'

export { defineLaw } from './law.ts'
export type { LawDefinition } from './law.ts'

export { defineCapability } from './capability.ts'
export type { CapabilityDefinition } from './capability.ts'

export {
  defineState,
  eventsOf,
  illegalTransitionsOf,
  statesOf,
  transition,
  transitionsOf,
} from './state.ts'
export type {
  EventOf,
  IllegalTransition,
  InitialStateOf,
  NextStateOf,
  StateDefinition,
  StateOf,
  TerminalStateOf,
  TransitionOf,
  TransitionTable,
} from './state.ts'

export { defineBenchmark } from './benchmark.ts'
export type { BenchmarkDefinition } from './benchmark.ts'

export { definePackage, definePackagePattern } from './package.ts'
export type { PackageDependencyDefinition, PackagePatternDefinition } from './package.ts'

export { defineLayout } from './layout.ts'
export type { LayoutConfiguration, LayoutDefinition, LayoutEntries } from './layout.ts'
