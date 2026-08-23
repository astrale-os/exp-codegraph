export const TYPESCRIPT_FACT_NAMESPACES = Object.freeze({
    project: 'typescript.project',
    diagnostic: 'typescript.diagnostic',
    source: 'typescript.source',
    symbol: 'typescript.symbol',
    occurrence: 'typescript.occurrence',
    body: 'typescript.body',
    module: 'astrale.typescript.module',
    declaration: 'astrale.typescript.module',
});
/** Native projectors callers may request; declaration facts are module support, not a projector. */
export const TYPESCRIPT_ANALYSIS_CAPABILITIES = Object.freeze([
    TYPESCRIPT_FACT_NAMESPACES.project,
    TYPESCRIPT_FACT_NAMESPACES.diagnostic,
    TYPESCRIPT_FACT_NAMESPACES.source,
    TYPESCRIPT_FACT_NAMESPACES.symbol,
    TYPESCRIPT_FACT_NAMESPACES.occurrence,
    TYPESCRIPT_FACT_NAMESPACES.body,
    TYPESCRIPT_FACT_NAMESPACES.module,
]);
export class TypeScriptFactContractError extends Error {
    code = 'TYPESCRIPT_FACT_CONTRACT_INVALID';
    kind;
    fact;
    diagnostics;
    constructor(kind, fact, diagnostics) {
        super(`Invalid ${kind} fact ${fact}: ${diagnostics.join(', ')}`);
        this.name = 'TypeScriptFactContractError';
        this.kind = kind;
        this.fact = fact;
        this.diagnostics = diagnostics;
    }
}
//# sourceMappingURL=model.js.map