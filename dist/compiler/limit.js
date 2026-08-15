/** Bound concurrent resource use without coupling the task implementation to queueing policy. */
export function createTaskLimiter(concurrency) {
    const capacity = positiveInteger(concurrency, 1);
    let active = 0;
    const waiting = [];
    const acquire = () => {
        if (active < capacity) {
            active++;
            return Promise.resolve();
        }
        return new Promise((resolve) => waiting.push(resolve));
    };
    const release = () => {
        const next = waiting.shift();
        if (next)
            next();
        else
            active--;
    };
    return {
        async run(task) {
            await acquire();
            try {
                return await task();
            }
            finally {
                release();
            }
        },
    };
}
function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
//# sourceMappingURL=limit.js.map