const HEARTBEAT_MS = 10_000;
const DEV_SPINNER_INTERVAL_MS = 80;
const DEV_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DEV_PHASES = [
    ['store.selection', 'Opening durable analysis cache'],
    ['application.inventory', 'Inventorying repository'],
    ['application.checkpoint', 'Opening reusable workspace checkpoint'],
    ['application.discovery', 'Discovering specifications'],
    ['application.compile', 'Compiling specification contracts'],
    ['application.statistics', 'Indexing repository statistics'],
    ['application.analysis', 'Refreshing semantic analysis'],
    ['application.qualification', 'Qualifying specifications'],
    ['application.projection', 'Preparing specification viewer'],
];
const devPhaseLabels = new Map(DEV_PHASES);
const phaseLabels = {
    discover: 'Discovering specifications',
    prepare: 'Preparing specification TypeScript',
    schemas: 'Checking schema catalog',
    packages: 'Checking package intent',
    contracts: 'Composing public contracts',
    code: 'Analyzing implementation boundaries',
};
/** Render real startup phases without inventing a percentage or unstable ETA. */
export function createDevStartupProgress(output) {
    const started = Date.now();
    const interactive = output.update !== undefined;
    const completed = new Set();
    let active = 'store.selection';
    let spinner = 0;
    let backend = 'analysis cache';
    let specifications;
    let closed = false;
    let animation;
    const render = () => {
        if (closed)
            return;
        const label = devPhaseLabels.get(active) ?? 'Initializing specification viewer';
        const milestone = `${completed.size}/${DEV_PHASES.length}`;
        const elapsed = formatElapsed(Date.now() - started);
        output.update?.(`\u001b[36m${DEV_SPINNER[spinner++ % DEV_SPINNER.length]}\u001b[0m \u001b[1m${label}\u001b[0m  \u001b[2m${milestone} · ${elapsed}\u001b[0m`);
    };
    const startAnimation = () => {
        if (!interactive || animation)
            return;
        animation = setInterval(render, DEV_SPINNER_INTERVAL_MS);
        animation.unref();
    };
    if (interactive) {
        output.update?.('\u001b[36m◆\u001b[0m \u001b[1mOpening durable analysis cache…\u001b[0m');
    }
    else
        output.out('Initializing specification viewer...');
    return {
        onTelemetry(event) {
            if (closed)
                return false;
            if (event.phase === 'store.selection') {
                const selected = event.metrics?.backend;
                if (typeof selected === 'string')
                    backend = `${selected} cache`;
                completed.add('store.selection');
                if (!interactive)
                    output.out(`CODEGRAPH_STORE=${selected ?? 'unknown'}`);
                return true;
            }
            if (!devPhaseLabels.has(event.phase))
                return false;
            const phase = event.phase;
            const status = event.metrics?.status;
            if (status === 'started') {
                active = phase;
                startAnimation();
                if (!interactive)
                    output.out(`${devPhaseLabels.get(phase)}...`);
            }
            else if (status === 'completed') {
                completed.add(phase);
                const count = event.metrics?.specifications;
                if (typeof count === 'number')
                    specifications = count;
            }
            render();
            return true;
        },
        succeed() {
            if (closed)
                return;
            closed = true;
            if (animation)
                clearInterval(animation);
            output.clear?.();
            const count = specifications === undefined ? '' : ` · ${specifications} specifications`;
            output.out(`✓ Specification viewer ready in ${formatElapsed(Date.now() - started)} · ${backend}${count}`);
        },
        fail() {
            if (closed)
                return;
            closed = true;
            if (animation)
                clearInterval(animation);
            output.clear?.();
        },
    };
}
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
function formatElapsed(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}
//# sourceMappingURL=progress.js.map