import { combineCompleteness } from '../../../facts/index.js';
import { stableJson } from '../../../identity/model.js';
import { ValueIndexTable } from './table.js';
const PREFIX = 'selection:typescript.calls:v1:';
export const CALL_SELECTION = 'typescript.calls/v1';
export const callSelectionKey = {
    global: `${PREFIX}global`, all: `${PREFIX}all`, unmapped: `${PREFIX}unmapped`,
    source: (source) => `${PREFIX}source:${JSON.stringify(source)}`,
    path: (path) => `${PREFIX}path:${JSON.stringify(path)}`,
};
export function callSelectionKeys(options) {
    const keys = [callSelectionKey.global];
    if (options.paths?.length === 0 || options.sources?.length === 0)
        return keys;
    if (options.sources)
        return [...keys, ...new Set(options.sources.map(callSelectionKey.source))];
    if (options.paths)
        return [...keys, ...new Set(options.paths.map(callSelectionKey.path)), callSelectionKey.unmapped];
    return [...keys, callSelectionKey.all];
}
// Execution topology may be partial while walkOwned still inventories every call.
const FLOW_ONLY = new Set([
    'CFG_EXPRESSION_BRANCH_PARTIAL', 'CFG_SWITCH_PARTIAL', 'CFG_TRY_PARTIAL',
    'CFG_LABEL_PARTIAL', 'CFG_UNRESOLVED_CONTINUE', 'CFG_UNRESOLVED_BREAK',
]);
export function inventoryCompleteness(completeness) {
    if (completeness.kind !== 'partial')
        return completeness;
    const reasons = completeness.reasons.filter(({ code }) => !FLOW_ONLY.has(code));
    return reasons.length ? { kind: 'partial', reasons } : { kind: 'complete' };
}
export function reasonKey(reason) {
    return JSON.stringify([reason.code, reason.message, Object.entries(reason.effective).sort(([left], [right]) => left.localeCompare(right))]);
}
export function unavailable(message) {
    return { kind: 'unavailable', reasons: [{ code: 'CALL_INVENTORY_UNAVAILABLE', message, retryable: false }] };
}
export function freezeCompleteness(value) {
    return Object.freeze(value.kind === 'complete' ? value : {
        ...value, reasons: Object.freeze(value.reasons.map((reason) => Object.freeze({ ...reason,
            ...('effective' in reason ? { effective: Object.freeze({ ...reason.effective }) } : {}),
        }))),
    });
}
/** Retain partial contributions even while unavailable reasons mask them. */
class CompletionCounts {
    partial;
    unavailable;
    #value;
    constructor(partial = new ValueIndexTable(), unavailable = new ValueIndexTable()) {
        this.partial = partial;
        this.unavailable = unavailable;
    }
    get empty() { return this.partial.size === 0 && this.unavailable.size === 0; }
    adjust(value, direction) {
        if (value.kind === 'complete')
            return this;
        const reasons = this[value.kind].edit();
        for (const reason of value.reasons) {
            const key = stableJson(reason);
            const count = (reasons.get(key)?.count ?? 0) + direction;
            if (count < 0)
                throw new Error('A call completeness contribution is missing.');
            if (count)
                reasons.set(key, { reason, count });
            else
                reasons.delete(key);
        }
        return value.kind === 'partial' ? new CompletionCounts(reasons.finish(), this.unavailable)
            : new CompletionCounts(this.partial, reasons.finish());
    }
    value() {
        return this.#value ??= freezeCompleteness(this.unavailable.size ? combineCompleteness(undefined, {
            kind: 'unavailable', reasons: [...this.unavailable.values()].map(({ reason }) => reason),
        }) : this.partial.size ? combineCompleteness(undefined, {
            kind: 'partial', reasons: [...this.partial.values()].map(({ reason }) => reason),
        }) : { kind: 'complete' });
    }
}
/** Persistent selection metadata, published with the same revision as its value columns. */
export class CallSelection {
    completion;
    unmapped;
    #attributed;
    #bySource;
    #unattributed;
    constructor(attributed = new ValueIndexTable(), bySource = new ValueIndexTable(), unattributed = new CompletionCounts(), completion = { kind: 'complete' }, unmapped = 0) {
        this.#attributed = attributed;
        this.#bySource = bySource;
        this.#unattributed = unattributed;
        this.completion = completion;
        this.unmapped = unmapped;
    }
    local(source) { return this.#bySource.get(source)?.value(); }
    *sources() {
        for (const [source, counts] of this.#bySource)
            yield [source, counts.value()];
    }
    update(bodies, touched, before, after, capabilities, changed) {
        const attributed = this.#attributed.edit(), bySource = this.#bySource.edit();
        let unattributed = this.#unattributed;
        const completionSources = new Set();
        for (const pair of bodies) {
            if (pair[0] === pair[1])
                continue;
            for (const [fact, direction] of [[pair[0], -1], [pair[1], 1]]) {
                if (!fact)
                    continue;
                if (fact.completeness.kind === 'partial')
                    for (const reason of fact.completeness.reasons) {
                        const key = reasonKey(reason), count = (attributed.get(key) ?? 0) + direction;
                        if (count < 0)
                            throw new Error('An attributed call completeness reason is missing.');
                        if (count)
                            attributed.set(key, count);
                        else
                            attributed.delete(key);
                    }
                const completion = inventoryCompleteness(fact.completeness);
                if (completion.kind === 'complete')
                    continue;
                const source = fact.provenance.evidence[0]?.source;
                if (source) {
                    completionSources.add(source);
                    const counts = (bySource.get(source) ?? new CompletionCounts()).adjust(completion, direction);
                    if (counts.empty)
                        bySource.delete(source);
                    else
                        bySource.set(source, counts);
                }
                else
                    unattributed = unattributed.adjust(completion, direction);
            }
        }
        const nextAttributed = attributed.finish(), nextSources = bySource.finish();
        for (const source of completionSources) {
            if (stableJson(this.local(source)) !== stableJson(nextSources.get(source)?.value()))
                touched.add(source);
        }
        let unmapped = this.unmapped;
        const relevant = (lookup, local, source) => lookup.sources.get(source)?.payload.logicalPath === undefined && (lookup.callsBySource.has(source) || local !== undefined && local.kind !== 'complete');
        for (const source of touched) {
            unmapped += Number(relevant(after, nextSources.get(source)?.value(), source)) - Number(relevant(before, this.local(source), source));
            changed?.add(callSelectionKey.source(source));
            for (const lookup of [before, after]) {
                const path = lookup.sources.get(source)?.payload.logicalPath;
                if (path !== undefined)
                    changed?.add(callSelectionKey.path(path));
            }
        }
        if (touched.size)
            changed?.add(callSelectionKey.all);
        if (unmapped !== this.unmapped)
            changed?.add(callSelectionKey.unmapped);
        let completion = { kind: 'complete' };
        for (const capability of ['typescript.body', 'typescript.source']) {
            const status = capabilities?.find((entry) => entry.capability === capability)?.completeness;
            const remaining = capability === 'typescript.body' && status?.kind === 'partial'
                ? status.reasons.filter((reason) => !nextAttributed.has(reasonKey(reason))) : undefined;
            completion = combineCompleteness(completion, remaining
                ? remaining.length ? { kind: 'partial', reasons: remaining } : { kind: 'complete' }
                : status ?? unavailable(`Required ${capability} capability is unavailable.`));
        }
        completion = freezeCompleteness(combineCompleteness(completion, unattributed.value()));
        if (stableJson(completion) !== stableJson(this.completion))
            changed?.add(callSelectionKey.global);
        return new CallSelection(nextAttributed, nextSources, unattributed, completion, unmapped);
    }
}
//# sourceMappingURL=selection.js.map