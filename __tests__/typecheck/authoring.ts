import {
  defineCode,
  defineLaw,
  defineLayout,
  defineState,
  transition,
  type EventOf,
  type InitialStateOf,
  type NextStateOf,
  type StateOf,
  type TerminalStateOf,
  type TransitionOf,
} from '../../authoring/index.ts'
import type { SpecificationSnapshot } from '../../specification/index.ts'

declare const specification: SpecificationSnapshot
const specificationFormat: 'astrale.typespec.specification' = specification.format
const specificationVersion: 2 = specification.version
void [specificationFormat, specificationVersion]
// @ts-expect-error normative snapshots expose no implementation binding
specification.module.binding
// @ts-expect-error resolved test evidence belongs to qualification
specification.laws[0]?.definitions[0]?.testEvidence
// @ts-expect-error physical layout observation belongs to analysis
specification.layout?.observation

const code = defineCode({ internals: ['../capture-method.ts'] })
const internal: '../capture-method.ts' = code.internals[0]
void internal

defineCode({
  internals: [
    // @ts-expect-error internal entrypoints must be paths
    1,
  ],
})

const layout = defineLayout(['src/', 'src/index.ts'])
const layoutPath: 'src/index.ts' = layout[1]
void layoutPath

const configuredLayout = defineLayout({
  entries: ['src/', 'src/index.ts'],
  exact: true,
  ignore: ['**/*.test.*'],
})
const configuredPath: 'src/index.ts' = configuredLayout.entries[1]
const configuredExact: true = configuredLayout.exact
void [configuredPath, configuredExact]

defineLayout({
  entries: [
    // @ts-expect-error paths must be strings
    1,
  ],
})

defineLayout({
  entries: ['src/'],
  // @ts-expect-error exact must be boolean
  exact: 'yes',
})

defineLayout({
  entries: ['src/'],
  ignore: [
    // @ts-expect-error ignore patterns must be strings
    1,
  ],
})

const job = defineState({
  initial: 'pending',
  tests: [{ file: '../__tests__/job.test.ts', id: 'JOB-FOLLOWS-LIFECYCLE' }],
  transitions: {
    pending: { start: 'running', cancel: 'cancelled' },
    running: { succeed: 'succeeded', cancel: 'cancelled' },
    succeeded: {},
    cancelled: {},
  },
})

defineLaw({
  id: 'JOB-TERMINAL',
  statement: 'Terminal jobs cannot transition.',
  tests: [{ file: '../__tests__/job.test.ts', id: 'JOB-REJECTS-TERMINAL' }],
})

const state: StateOf<typeof job> = 'running'
const event: EventOf<typeof job, 'pending'> = 'start'
const next: NextStateOf<typeof job, 'pending', 'start'> = 'running'
const initial: InitialStateOf<typeof job> = 'pending'
const terminal: TerminalStateOf<typeof job> = 'cancelled'
const transitionValue: TransitionOf<typeof job> = {
  from: 'running',
  event: 'succeed',
  to: 'succeeded',
}
const inferred: 'running' = transition(job, 'pending', 'start')

void [state, event, next, initial, terminal, transitionValue, inferred]

// @ts-expect-error succeeded has no start event
transition(job, 'succeeded', 'start')

// @ts-expect-error missing is not one of the declared states
defineState({ initial: 'missing', transitions: { pending: {} } })

defineState({
  transitions: {
    pending: {
      // @ts-expect-error every target must be a declared state
      start: 'missing',
    },
    running: {},
  },
})

defineState({
  // @ts-expect-error state identities must be strings
  transitions: {
    1: {},
  },
})
