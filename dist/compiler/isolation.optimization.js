import { planDeclarationCompilerUniverses } from '../api/project.js';
/**
 * Plan worker batches from semantic compatibility. Explicit caller batch bounds and any planner
 * uncertainty retain deterministic fixed-capacity fallback; aggregate overflow still recursively
 * splits through the canonical isolated path.
 */
export const API_COMPILER_OPTIMIZATION = {
    fallbackMaximumBatchEntries: 32,
    batchOutputExceeded(results) {
        return results.every((result) => result.diagnostics.some((entry) => entry.code === 'isolation/output-limit' &&
            entry.message.startsWith('API compiler batch exceeded its ')));
    },
    plan(requests, explicitMaximum) {
        const maximum = positiveInteger(explicitMaximum, this.fallbackMaximumBatchEntries);
        if (explicitMaximum !== undefined) {
            return { batches: fixedBatches(requests.length, maximum), outcome: 'explicit' };
        }
        if (requests.every((request) => request.declarationModel === false)) {
            return {
                batches: requests.length ? [Array.from(requests.keys())] : [],
                outcome: 'diagnostics-universe',
            };
        }
        try {
            const planned = planDeclarationCompilerUniverses(requests);
            return { batches: planned.length ? planned : [], outcome: 'compatible' };
        }
        catch {
            // Planner uncertainty retains the deterministic bounded fallback.
            return { batches: fixedBatches(requests.length, maximum), outcome: 'fallback' };
        }
    },
};
function fixedBatches(length, maximum) {
    const batches = [];
    for (let index = 0; index < length; index += maximum) {
        batches.push(Array.from({ length: Math.min(maximum, length - index) }, (_, offset) => index + offset));
    }
    return batches;
}
function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
//# sourceMappingURL=isolation.optimization.js.map