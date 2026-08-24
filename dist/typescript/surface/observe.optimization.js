import { observeDeclaration } from './declaration.js';
import { canonicalSymbolIdentity } from './symbol.js';
const observations = new WeakMap();
/** Reuse one immutable checker-owned declaration normalization across entrypoint projections. */
export function observeDeclarationOnce(catalogRoot, checker, symbol, semantics) {
    let byIdentity = observations.get(checker);
    if (!byIdentity) {
        byIdentity = new Map();
        observations.set(checker, byIdentity);
    }
    const identity = `${catalogRoot}\0${semantics}\0${canonicalSymbolIdentity(catalogRoot, symbol)}`;
    const existing = byIdentity.get(identity);
    if (existing)
        return existing;
    const observed = observeDeclaration(catalogRoot, checker, symbol, [], semantics);
    byIdentity.set(identity, observed);
    return observed;
}
//# sourceMappingURL=observe.optimization.js.map