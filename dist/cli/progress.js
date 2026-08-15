const HEARTBEAT_MS = 10_000;
const phaseLabels = {
    discover: 'Discovering specifications',
    prepare: 'Preparing specification TypeScript',
    schemas: 'Checking schema catalog',
    packages: 'Checking package intent',
    contracts: 'Composing public contracts',
    code: 'Analyzing implementation boundaries',
};
/** Render stable, line-oriented progress that remains useful in agent and CI logs. */
export function createCliProgress(output, quiet) {
    if (quiet)
        return { onProgress: () => undefined, close: () => undefined };
    let phase = 'discover';
    let lastActivity = Date.now();
    const active = new Set();
    const heartbeat = setInterval(() => {
        const elapsed = Date.now() - lastActivity;
        if (elapsed < HEARTBEAT_MS)
            return;
        const seconds = Math.max(1, Math.round(elapsed / 1_000));
        const suffix = active.size ? ` Active: ${[...active].sort().join(', ')}.` : '';
        output.out(`Still checking ${phase} after ${seconds}s.${suffix}`);
    }, HEARTBEAT_MS);
    heartbeat.unref();
    return {
        onProgress(event) {
            phase = event.phase;
            lastActivity = Date.now();
            if (event.phase === 'load') {
                if (event.status === 'started') {
                    active.add(event.source);
                    return;
                }
                active.delete(specDirectory(event.source));
                output.out(`[${event.completed}/${event.total}] ${event.source}`);
                return;
            }
            if (event.status === 'started') {
                output.out(`${phaseLabels[event.phase]}...`);
            }
            else if (event.phase === 'discover') {
                output.out(`Found ${event.total ?? 0} specification${event.total === 1 ? '' : 's'}.`);
            }
        },
        close() {
            clearInterval(heartbeat);
        },
    };
}
function specDirectory(source) {
    if (source.endsWith('/api.d.ts'))
        return source.slice(0, -'api.d.ts'.length).replace(/\/$/u, '');
    return source;
}
//# sourceMappingURL=progress.js.map