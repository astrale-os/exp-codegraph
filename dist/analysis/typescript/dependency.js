import { deriveAnalysisId } from '../identity/index.js';
import { TYPESCRIPT_MODULE_FACT_NAMESPACE } from './model.js';
export function typeScriptDependencyIdentity(input) {
    return deriveAnalysisId('typescript-dependency', TYPESCRIPT_MODULE_FACT_NAMESPACE, input);
}
export function typeScriptDependencyOccurrenceIdentity(dependency, input) {
    return deriveAnalysisId('occurrence', `${TYPESCRIPT_MODULE_FACT_NAMESPACE}:${dependency}`, {
        typeOnly: input.typeOnly,
        specifier: input.specifier,
        deep: input.deep,
        location: input.location,
        declaration: input.declaration ?? '',
        publicPath: input.publicPath ?? [],
    });
}
//# sourceMappingURL=dependency.js.map