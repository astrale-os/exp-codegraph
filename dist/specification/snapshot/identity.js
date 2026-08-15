/** Deterministic identity namespace for one module inside a specification anchor. */
export function specificationModuleId(source, declarationPointer) {
    return declarationPointer ? `${source}#${declarationPointer}` : source;
}
//# sourceMappingURL=identity.js.map