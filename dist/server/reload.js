import { stat } from 'node:fs/promises';
/** Coalesce event bursts and rebuild only after the latest edit has remained quiet. */
export function createRebuildScheduler(rebuild, debounceMs = 80) {
    let requested = 0;
    let completed = 0;
    let running;
    return {
        request() {
            requested++;
            if (running)
                return running;
            running = (async () => {
                let latest;
                let changed = false;
                while (completed < requested) {
                    await waitForQuiet();
                    const target = requested;
                    latest = await rebuild();
                    changed ||= latest.changed;
                    completed = target;
                }
                if (!latest)
                    throw new Error('Rebuild scheduler completed without rebuilding.');
                return { ...latest, changed };
            })().finally(() => {
                running = undefined;
            });
            return running;
        },
    };
    async function waitForQuiet() {
        let observed;
        do {
            observed = requested;
            await delay(debounceMs);
        } while (observed !== requested);
    }
}
/** Suppress duplicate watcher notifications without interpreting source semantics. */
export function createSourceChangeFilter(capacity = 4_096) {
    const observed = new Map();
    return {
        async changed(file) {
            const fingerprint = await sourceFingerprint(file);
            const previous = observed.get(file);
            observed.delete(file);
            observed.set(file, fingerprint);
            while (observed.size > capacity)
                observed.delete(observed.keys().next().value);
            return previous !== fingerprint;
        },
    };
}
async function sourceFingerprint(file) {
    try {
        const details = await stat(file, { bigint: true });
        return [details.dev, details.ino, details.size, details.mtimeNs, details.ctimeNs].join(':');
    }
    catch (error) {
        if (!isMissing(error))
            throw error;
        return 'missing';
    }
}
function delay(durationMs) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}
function isMissing(error) {
    return (!!error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT');
}
//# sourceMappingURL=reload.js.map