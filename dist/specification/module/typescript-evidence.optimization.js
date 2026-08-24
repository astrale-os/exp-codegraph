import { captureModuleTypeScriptEvidence } from './typescript-evidence.js';
import { canonicalModuleTypeScriptPath as canonicalFile } from './typescript-reference.optimization.js';
/**
 * Index immutable evidence once per Program source, then project exact owner closures without
 * repeatedly walking and resolving the same dependency source for every overlapping owner.
 */
export function createModuleTypeScriptEvidenceProjection(program, options, observed) {
    const byFile = new Map(program.getSourceFiles().map((source) => [
        canonicalFile(source.fileName),
        captureModuleTypeScriptEvidence(program, options, [source], observed).sources[0],
    ]));
    return (sources) => {
        const selected = sources.map((source) => byFile.get(canonicalFile(source.fileName)));
        return { sources: selected };
    };
}
//# sourceMappingURL=typescript-evidence.optimization.js.map