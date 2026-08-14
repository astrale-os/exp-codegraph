import type { TestEvidenceReference } from './evidence.ts'

export type TransitionTable = Readonly<Record<string, Readonly<Record<string, string>>>>

type StringKeysOnly<Value> = Extract<keyof Value, number> extends never ? unknown : never

type ValidTransitionTargets<Transitions extends TransitionTable> = {
  readonly [State in keyof Transitions]: StringKeysOnly<Transitions[State]> & {
    readonly [Event in keyof Transitions[State]]: Transitions[State][Event] extends keyof Transitions
      ? Transitions[State][Event]
      : never
  }
}

export interface StateDefinition<
  Transitions extends TransitionTable = TransitionTable,
  Initial extends (keyof Transitions & string) | undefined =
    | (keyof Transitions & string)
    | undefined,
> {
  readonly initial?: Initial
  readonly transitions: Transitions
  /** Optional stable test identities in explicit module-root-relative evidence files. */
  readonly tests?: readonly TestEvidenceReference[]
}

/**
 * Preserve one deterministic transition relation while statically requiring every target and the
 * optional initial state to belong to the relation's state set.
 */
export function defineState<
  const Transitions extends TransitionTable,
  const Initial extends (keyof Transitions & string) | undefined = undefined,
>(
  definition: StateDefinition<Transitions, Initial> & {
    readonly transitions: Transitions &
      StringKeysOnly<Transitions> &
      ValidTransitionTargets<Transitions>
  },
): StateDefinition<Transitions, Initial> {
  return definition
}

type TransitionsOf<Definition> =
  Definition extends StateDefinition<infer Transitions, infer _Initial> ? Transitions : never

export type StateOf<Definition> = keyof TransitionsOf<Definition> & string

export type EventOf<
  Definition,
  State extends StateOf<Definition> = StateOf<Definition>,
> = State extends keyof TransitionsOf<Definition>
  ? keyof TransitionsOf<Definition>[State] & string
  : never

export type NextStateOf<
  Definition,
  State extends StateOf<Definition>,
  Event extends EventOf<Definition, State>,
> = TransitionsOf<Definition>[State][Event] & StateOf<Definition>

export type TransitionOf<Definition> = {
  readonly [State in StateOf<Definition>]: {
    readonly [Event in EventOf<Definition, State>]: {
      readonly from: State
      readonly event: Event
      readonly to: NextStateOf<Definition, State, Event>
    }
  }[EventOf<Definition, State>]
}[StateOf<Definition>]

export type InitialStateOf<Definition> =
  Definition extends StateDefinition<infer _Transitions, infer Initial> ? Initial : never

export type TerminalStateOf<Definition> = {
  readonly [State in StateOf<Definition>]: EventOf<Definition, State> extends never ? State : never
}[StateOf<Definition>]

export interface IllegalTransition<Definition> {
  readonly from: StateOf<Definition>
  readonly event: EventOf<Definition>
}

export function statesOf<const Definition extends StateDefinition>(
  definition: Definition,
): StateOf<Definition>[] {
  return Object.keys(definition.transitions) as StateOf<Definition>[]
}

export function eventsOf<const Definition extends StateDefinition>(
  definition: Definition,
): EventOf<Definition>[]
export function eventsOf<
  const Definition extends StateDefinition,
  const State extends StateOf<Definition>,
>(definition: Definition, state: State): EventOf<Definition, State>[]
export function eventsOf<const Definition extends StateDefinition>(
  definition: Definition,
  state?: StateOf<Definition>,
): EventOf<Definition>[] {
  if (state !== undefined) {
    return Object.keys(definition.transitions[state] ?? {}) as EventOf<Definition>[]
  }
  const events = new Set<EventOf<Definition>>()
  for (const transitions of Object.values(definition.transitions)) {
    for (const event of Object.keys(transitions)) events.add(event as EventOf<Definition>)
  }
  return [...events]
}

export function transitionsOf<const Definition extends StateDefinition>(
  definition: Definition,
): TransitionOf<Definition>[] {
  const transitions: TransitionOf<Definition>[] = []
  for (const from of statesOf(definition)) {
    for (const event of eventsOf(definition, from)) {
      transitions.push({
        from,
        event,
        to: definition.transitions[from]![event]!,
      } as TransitionOf<Definition>)
    }
  }
  return transitions
}

export function illegalTransitionsOf<const Definition extends StateDefinition>(
  definition: Definition,
): IllegalTransition<Definition>[] {
  const illegal: IllegalTransition<Definition>[] = []
  const events = eventsOf(definition)
  for (const from of statesOf(definition)) {
    const legal = definition.transitions[from]!
    for (const event of events) {
      if (!Object.hasOwn(legal, event)) illegal.push({ from, event })
    }
  }
  return illegal
}

export function transition<
  const Definition extends StateDefinition,
  const State extends StateOf<Definition>,
  const Event extends EventOf<Definition, State>,
>(definition: Definition, state: State, event: Event): NextStateOf<Definition, State, Event> {
  const target = definition.transitions[state]?.[event]
  if (target === undefined) {
    throw new Error(`Illegal state transition: ${String(state)} + ${String(event)}`)
  }
  return target as NextStateOf<Definition, State, Event>
}
