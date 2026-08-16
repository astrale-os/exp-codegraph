import { viewerSpecificationDiagnostics } from './specification.js';
export const CATALOG_INDEX_FORMAT = 'astrale.spec.catalog-index';
export const CATALOG_SPEC_FORMAT = 'astrale.spec.catalog-spec';
export const CATALOG_SOURCE_FORMAT = 'astrale.spec.catalog-source';
export const CATALOG_TRANSPORT_VERSION = 3;
export const CATALOG_SPEC_ENDPOINT = '/__astrale/spec-catalog/spec';
export const CATALOG_SOURCE_ENDPOINT = '/__astrale/spec-catalog/source';
export const HISTORY_RESOURCE_ENDPOINT = '/__astrale/spec-history';
/** Derive the exact navigation status shown for a complete Spec. */
export function catalogSpecMetrics(spec) {
    const validationErrors = viewerSpecificationDiagnostics(spec).length;
    const verificationErrors = spec.verification?.rules
        .filter((rule) => rule.status === 'fail' || rule.status === 'error')
        .reduce((count, rule) => count + Math.max(1, rule.diagnostics.length), 0) ?? 0;
    return {
        errors: validationErrors + verificationErrors,
        open: 0,
        status: validationErrors
            ? 'error'
            : (spec.verification?.status ??
                (spec.modules.some((module) => module.contract) ? 'pending' : 'ok')),
    };
}
//# sourceMappingURL=catalog.js.map