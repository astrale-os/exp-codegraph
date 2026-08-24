import { MODULE_LAYOUT_PROFILE_ID, MODULE_SCHEMA_PROFILE_ID, MODULE_TEST_EVIDENCE_PROFILE_ID, SPECIFICATION_VALIDITY_PROFILE_ID, } from '../../conformance/index.js';
import { CLI_CHECK_LIMITS } from '../limits.js';
export const CHECK_RESULT_FORMAT = 'astrale.codegraph.cli-check-result';
export const CHECK_RESULT_VERSION = 2;
export const CHECK_RESULT_ARTIFACT = 'cli/check-result.json.br';
export const CHECK_CATALOG_FORMAT = 'astrale.codegraph.cli-check-catalog';
export const CHECK_CATALOG_VERSION = 1;
export const CHECK_CATALOG_ARTIFACT = 'cli/check-catalog.json.br';
export const SEMANTIC_PACK_FORMAT = 'astrale.codegraph.cli-check-pack';
export const SEMANTIC_PACK_VERSION = 2;
export const MAXIMUM_CHECK_RESULT_BYTES = 16 * 1024 * 1024;
export const MAXIMUM_CHECK_CATALOG_BYTES = CLI_CHECK_LIMITS.maximumCatalogCheckpointDecodedBytes;
export const CHECK_SEMANTIC_PLAN = Object.freeze({
    format: 'astrale.codegraph.cli-check-semantic-plan',
    version: 1,
    requestedCapabilities: Object.freeze([]),
    requestedProfiles: Object.freeze([
        SPECIFICATION_VALIDITY_PROFILE_ID,
        MODULE_LAYOUT_PROFILE_ID,
        MODULE_SCHEMA_PROFILE_ID,
        MODULE_TEST_EVIDENCE_PROFILE_ID,
    ]),
    compilerAnalysis: false,
    schemaRoots: Object.freeze([]),
});
export function isCheckSemanticPlan(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const plan = value;
    return (plan.format === CHECK_SEMANTIC_PLAN.format &&
        plan.version === CHECK_SEMANTIC_PLAN.version &&
        plan.compilerAnalysis === false &&
        sameStrings(plan.requestedCapabilities, CHECK_SEMANTIC_PLAN.requestedCapabilities) &&
        sameStrings(plan.requestedProfiles, CHECK_SEMANTIC_PLAN.requestedProfiles) &&
        sameStrings(plan.schemaRoots, CHECK_SEMANTIC_PLAN.schemaRoots));
}
export function isApplicationCheckpointReference(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const reference = value;
    return (typeof reference.scope === 'string' &&
        /^application-[0-9a-f]{32}$/u.test(reference.scope) &&
        typeof reference.manifestSha256 === 'string' &&
        /^[0-9a-f]{64}$/u.test(reference.manifestSha256));
}
export function isStoredCheckResult(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const result = value;
    return (result.format === CHECK_RESULT_FORMAT &&
        result.version === CHECK_RESULT_VERSION &&
        typeof result.producerFingerprint === 'string' &&
        (result.sourceProof === undefined || typeof result.sourceProof === 'string') &&
        typeof result.request === 'string' &&
        typeof result.repository === 'string' &&
        typeof result.inventory === 'string' &&
        typeof result.snapshot === 'string' &&
        Number.isSafeInteger(result.exitCode) &&
        (result.exitCode === 0 || result.exitCode === 1) &&
        Array.isArray(result.transcript) &&
        result.transcript.every((entry) => entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            (entry.channel === 'stdout' || entry.channel === 'stderr') &&
            typeof entry.message === 'string'));
}
export function isStoredCheckCatalog(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const stored = value;
    if (stored.format !== CHECK_CATALOG_FORMAT ||
        stored.version !== CHECK_CATALOG_VERSION ||
        typeof stored.producerFingerprint !== 'string' ||
        (stored.sourceProof !== undefined && typeof stored.sourceProof !== 'string') ||
        typeof stored.family !== 'string' ||
        typeof stored.repository !== 'string' ||
        typeof stored.inventory !== 'string' ||
        typeof stored.snapshot !== 'string' ||
        !stored.catalog ||
        typeof stored.catalog !== 'object')
        return false;
    const catalog = stored.catalog;
    return (Array.isArray(catalog.sharedDiagnostics) &&
        Array.isArray(catalog.specifications) &&
        catalog.specifications.every(isCatalogSpecification) &&
        Array.isArray(catalog.qualifications) &&
        catalog.qualifications.every(isCatalogQualification));
}
function sameStrings(value, expected) {
    return Array.isArray(value) &&
        value.length === expected.length &&
        value.every((item, index) => item === expected[index]);
}
function isCatalogSpecification(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const specification = value;
    return (typeof specification.id === 'string' &&
        typeof specification.source === 'string' &&
        typeof specification.root === 'string' &&
        Array.isArray(specification.sourceReferences) &&
        specification.sourceReferences.every((reference) => reference &&
            typeof reference === 'object' &&
            !Array.isArray(reference) &&
            reference.target &&
            typeof reference.target === 'object' &&
            !Array.isArray(reference.target) &&
            typeof reference.target.source === 'string') &&
        Array.isArray(specification.diagnostics));
}
function isCatalogQualification(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const qualification = value;
    return (typeof qualification.id === 'string' &&
        typeof qualification.status === 'string' &&
        typeof qualification.source === 'string' &&
        Array.isArray(qualification.diagnostics));
}
//# sourceMappingURL=model.js.map