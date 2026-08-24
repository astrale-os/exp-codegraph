import { applicationCheckpointScope, createApplicationCheckpoint, } from '../checkpoint/index.js';
/** Compose worktree-local and proof-bound portable checkpoint stores behind one application port. */
export function createNodeApplicationCheckpoint(options) {
    const local = options.local && createApplicationCheckpoint({
        store: options.local,
        producerFingerprint: options.producerFingerprint,
    });
    const portable = options.portable && bindPortableCheckpoint(createApplicationCheckpoint({
        store: options.portable.store,
        producerFingerprint: options.producerFingerprint,
    }), options.portable);
    const readers = [local, portable].filter((checkpoint) => checkpoint !== undefined);
    if (!readers.length)
        return;
    const writers = readers.filter((checkpoint) => checkpoint.publication !== 'disabled');
    return {
        publication: writers.length ? 'enabled' : 'disabled',
        async load(expectation) {
            const primary = local && await local.load(expectation);
            if (primary?.ok && primary.exact)
                return primary;
            const secondary = portable && await portable.load(expectation);
            if (secondary?.ok)
                return secondary;
            if (primary?.ok)
                return primary;
            return secondary ?? primary ?? missing();
        },
        async publish(expectation, content) {
            const settled = await Promise.allSettled(writers.map((checkpoint) => checkpoint.publish(expectation, content)));
            const failures = settled.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
            if (failures.length) {
                throw new AggregateError(failures, 'Application checkpoint publication failed.');
            }
        },
    };
}
function bindPortableCheckpoint(checkpoint, options) {
    const bind = (expectation) => ({
        ...expectation,
        sourceProof: options.sourceProof,
        ...(options.reference ? { manifestSha256: options.reference.manifestSha256 } : {}),
    });
    return {
        publication: options.writable ? 'enabled' : 'disabled',
        async load(expectation) {
            const bound = bind(expectation);
            if (options.reference &&
                applicationCheckpointScope(bound) !== options.reference.scope)
                return missing('incompatible');
            return checkpoint.load(bound);
        },
        async publish(expectation, content) {
            if (!options.writable)
                return;
            const { manifestSha256: _manifestSha256, ...bound } = bind(expectation);
            await checkpoint.publish(bound, content);
        },
    };
}
function missing(reason = 'missing') {
    return { ok: false, reason };
}
//# sourceMappingURL=checkpoint.js.map