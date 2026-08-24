/** Execute independent physical checkpoint work with one explicit concurrency ceiling. */
export async function mapCheckpointWork(values, concurrency, operation) {
    const output = new Array(values.length);
    let next = 0;
    let failure;
    const worker = async () => {
        while (failure === undefined) {
            const index = next++;
            if (index >= values.length)
                return;
            try {
                output[index] = await operation(values[index]);
            }
            catch (error) {
                failure ??= error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
    if (failure !== undefined)
        throw failure;
    return output;
}
//# sourceMappingURL=store.optimization.js.map