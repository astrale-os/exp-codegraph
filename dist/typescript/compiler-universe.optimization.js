import ts from 'typescript';
const ambientEffects = new WeakMap();
/** Classify source that can change sibling meaning inside a shared TypeScript Program. */
export function typeScriptSourceHasAmbientEffects(source) {
    const cached = ambientEffects.get(source);
    if (cached !== undefined)
        return cached;
    if (!ts.isExternalModule(source) || source.libReferenceDirectives.length > 0) {
        ambientEffects.set(source, true);
        return true;
    }
    let ambient = false;
    const visit = (node) => {
        if (ts.isNamespaceExportDeclaration(node) ||
            (ts.isModuleDeclaration(node) &&
                ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0 || ts.isStringLiteral(node.name)))) {
            ambient = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    ambientEffects.set(source, ambient);
    return ambient;
}
//# sourceMappingURL=compiler-universe.optimization.js.map