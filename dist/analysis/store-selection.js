import { createMemoryAnalysisStore } from './memory/index.js';
export class AnalysisStoreUnavailableError extends Error {
    name = 'AnalysisStoreUnavailableError';
    code = 'DURABLE_STORE_UNAVAILABLE';
}
/** Resolve persistence once; required durability fails and advisory durability is explicit. */
export async function selectAnalysisStore(options) {
    if (options.openDurable) {
        try {
            return {
                store: await options.openDurable(),
                backend: 'durable',
                persistence: options.persistence,
            };
        }
        catch (cause) {
            if (options.persistence === 'required') {
                throw new AnalysisStoreUnavailableError('Required durable analysis store is unavailable.', {
                    cause,
                });
            }
            return {
                store: createMemoryAnalysisStore(options.memory),
                backend: 'memory',
                persistence: 'advisory',
                fallback: {
                    code: 'DURABLE_STORE_UNAVAILABLE',
                    message: cause instanceof Error ? cause.message : String(cause),
                    cause,
                },
            };
        }
    }
    if (options.persistence === 'required') {
        throw new AnalysisStoreUnavailableError('Required durable analysis store has no configured factory.');
    }
    return {
        store: createMemoryAnalysisStore(options.memory),
        backend: 'memory',
        persistence: 'advisory',
    };
}
//# sourceMappingURL=store-selection.js.map