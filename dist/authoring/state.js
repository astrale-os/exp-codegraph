/**
 * Preserve one deterministic transition relation while statically requiring every target and the
 * optional initial state to belong to the relation's state set.
 */
export function defineState(definition) {
    return definition;
}
export function statesOf(definition) {
    return Object.keys(definition.transitions);
}
export function eventsOf(definition, state) {
    if (state !== undefined) {
        return Object.keys(definition.transitions[state] ?? {});
    }
    const events = new Set();
    for (const transitions of Object.values(definition.transitions)) {
        for (const event of Object.keys(transitions))
            events.add(event);
    }
    return [...events];
}
export function transitionsOf(definition) {
    const transitions = [];
    for (const from of statesOf(definition)) {
        for (const event of eventsOf(definition, from)) {
            transitions.push({
                from,
                event,
                to: definition.transitions[from][event],
            });
        }
    }
    return transitions;
}
export function illegalTransitionsOf(definition) {
    const illegal = [];
    const events = eventsOf(definition);
    for (const from of statesOf(definition)) {
        const legal = definition.transitions[from];
        for (const event of events) {
            if (!Object.hasOwn(legal, event))
                illegal.push({ from, event });
        }
    }
    return illegal;
}
export function transition(definition, state, event) {
    const target = definition.transitions[state]?.[event];
    if (target === undefined) {
        throw new Error(`Illegal state transition: ${String(state)} + ${String(event)}`);
    }
    return target;
}
//# sourceMappingURL=state.js.map