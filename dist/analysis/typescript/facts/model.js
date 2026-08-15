export const TYPESCRIPT_FACT_NAMESPACES = Object.freeze({
    project: 'typescript.project',
    diagnostic: 'typescript.diagnostic',
    source: 'typescript.source',
    symbol: 'typescript.symbol',
    occurrence: 'typescript.occurrence',
    body: 'typescript.body',
    module: 'astrale.typescript.module',
});
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