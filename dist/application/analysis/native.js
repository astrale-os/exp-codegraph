import { createProcessNativeAnalysisSessionFactory } from '../../analysis/index.js';
import { resolvePackagedNativeAnalysis } from '../../analysis/typescript/distribution/index.js';
/** Lazily admit the packaged or explicit native analyzer when a project is first analyzed. */
export function createCodegraphApplicationSessionFactory(options = {}) {
    return {
        async open(project, openOptions) {
            openOptions?.signal?.throwIfAborted();
            const native = await resolvePackagedNativeAnalysis({
                ...(options.binary ? { binary: options.binary } : {}),
            });
            openOptions?.signal?.throwIfAborted();
            return createProcessNativeAnalysisSessionFactory({
                command: native.command,
                ...(options.maximumFrameBytes !== undefined
                    ? { maximumFrameBytes: options.maximumFrameBytes }
                    : {}),
                ...(options.transactionChunkFrameBytes !== undefined
                    ? { transactionChunkFrameBytes: options.transactionChunkFrameBytes }
                    : {}),
                ...(options.maximumTransactionBytes !== undefined
                    ? { maximumTransactionBytes: options.maximumTransactionBytes }
                    : {}),
                ...(options.maximumResidentBytes !== undefined
                    ? { maximumResidentBytes: options.maximumResidentBytes }
                    : {}),
                ...(options.environment
                    ? { environment: definedEnvironment(options.environment) }
                    : {}),
                ...(options.telemetry ? { telemetry: options.telemetry } : {}),
            }).open(project, openOptions);
        },
    };
}
function definedEnvironment(environment) {
    return Object.fromEntries(Object.entries(environment).filter((entry) => entry[1] !== undefined));
}
//# sourceMappingURL=native.js.map