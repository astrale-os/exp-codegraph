export function errorDiagnostic(code, error, file) {
    return {
        code,
        message: error instanceof Error ? error.message : String(error),
        file,
        line: 1,
        column: 1,
    };
}
//# sourceMappingURL=diagnostic.js.map