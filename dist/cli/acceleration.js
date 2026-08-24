export function createCliAccelerationReceipt(events) {
    return Object.freeze({
        format: 'astrale.codegraph.cli-acceleration-receipt',
        version: 1,
        events: Object.freeze(events.map((event) => Object.freeze(event))),
    });
}
export function cliAccelerationError(error) {
    const name = error instanceof Error ? error.name : 'unknown';
    const input = error instanceof Error ? error.message : String(error);
    const message = input.length <= 1_000 ? input : `${input.slice(0, 1_000)}…`;
    return { name, message };
}
export function createCliAccelerationEvent(operation, outcome, code, started, error) {
    return {
        operation,
        outcome,
        code,
        durationMs: performance.now() - started,
        ...(error === undefined ? {} : { error: cliAccelerationError(error) }),
    };
}
//# sourceMappingURL=acceleration.js.map