import { createHash } from 'node:crypto';
export function createApplicationSnapshot(input) {
    const content = {
        format: 'astrale.typespec.application',
        version: 2,
        ...input,
    };
    const id = `application:${digest(identityPreimage(content))}`;
    return immutable({ ...content, id });
}
/**
 * Compose already content-addressed children instead of duplicating their rich payloads in one
 * repository-sized JSON string. Statistics do not yet expose their own identity, so they receive
 * one bounded local digest while the application remains their immutable owner.
 */
function identityPreimage(content) {
    return {
        format: content.format,
        version: content.version,
        repository: content.repository,
        inventory: content.inventory,
        capabilities: content.capabilities,
        selection: content.selection,
        specifications: content.specifications.map((value) => value.id),
        ...(content.statistics ? { statistics: digest(content.statistics) } : {}),
        qualifications: content.qualifications.map((value) => value.id),
        analysis: content.analysis,
        diagnostics: content.diagnostics,
        analysisDiagnostics: content.analysisDiagnostics,
    };
}
function digest(value) {
    return createHash('sha256').update(stableJson(value)).digest('hex');
}
function stableJson(value) {
    return JSON.stringify(canonical(value));
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}
function immutable(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    for (const entry of Object.values(value))
        immutable(entry);
    return Object.freeze(value);
}
//# sourceMappingURL=create.js.map