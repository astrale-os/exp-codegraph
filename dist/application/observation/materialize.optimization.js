const MAXIMUM_CONCURRENT_OWNER_OBSERVATIONS = 4;
/** Index immutable inventory paths once for every owner observation in the operation. */
export function indexApplicationObservationInventory(inventory) {
    const byPath = new Map();
    const historyByRoot = new Map();
    for (const file of inventory.files) {
        byPath.set(file.path, file);
        const historyRoot = owningHistoryRoot(file.path);
        if (!historyRoot)
            continue;
        const history = historyByRoot.get(historyRoot) ?? [];
        history.push(file);
        historyByRoot.set(historyRoot, history);
    }
    for (const history of historyByRoot.values()) {
        history.sort((left, right) => left.path.localeCompare(right.path));
    }
    return { byPath, historyByRoot };
}
/** Schedule independent owner reads concurrently while retaining canonical input order. */
export async function mapApplicationObservationOwners(inputs, operation) {
    const output = new Array(inputs.length);
    const failures = [];
    let next = 0;
    let stopped = false;
    await Promise.all(Array.from({ length: Math.min(MAXIMUM_CONCURRENT_OWNER_OBSERVATIONS, inputs.length) }, async () => {
        while (true) {
            if (stopped)
                return;
            const index = next++;
            if (index >= inputs.length)
                return;
            try {
                output[index] = await operation(inputs[index]);
            }
            catch (error) {
                stopped = true;
                failures.push({ index, error });
            }
        }
    }));
    if (failures.length) {
        failures.sort((left, right) => left.index - right.index);
        throw failures[0].error;
    }
    return output;
}
function owningHistoryRoot(path) {
    if (path.startsWith('.history/'))
        return '.history/';
    const marker = '/.history/';
    const offset = path.indexOf(marker);
    return offset < 0 ? undefined : `${path.slice(0, offset)}${marker}`;
}
//# sourceMappingURL=materialize.optimization.js.map