export function viewerSpecificationDiagnostics(specification) {
    return [
        ...specification.diagnostics,
        ...specification.modules.flatMap((module) => module.diagnostics),
    ];
}
//# sourceMappingURL=specification.js.map