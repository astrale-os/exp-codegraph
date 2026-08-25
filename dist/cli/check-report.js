export const CLI_CHECK_REPORT_FORMAT = 'astrale.codegraph.check-report';
export const CLI_CHECK_REPORT_VERSION = 1;
/** Losslessly coalesce only projection variants of one exact source diagnostic cause. */
export function groupDiagnostics(values) {
    const groups = new Map();
    for (const value of values) {
        const cause = JSON.stringify([
            value.code,
            value.message,
            value.file,
            value.line,
            value.column,
        ]);
        const pointer = value.pointer ?? null;
        const existing = groups.get(cause);
        if (existing) {
            if (!existing.observedPointers.has(pointer)) {
                existing.observedPointers.add(pointer);
                existing.pointers.push(pointer);
            }
            continue;
        }
        groups.set(cause, {
            code: value.code,
            message: value.message,
            file: value.file,
            line: value.line,
            column: value.column,
            pointers: [pointer],
            observedPointers: new Set([pointer]),
        });
    }
    return [...groups.values()].map(({ observedPointers: _, ...group }) => group);
}
export function createCliCheckReport(input) {
    const diagnosticOccurrences = input.diagnostics.reduce((total, diagnostic) => total + diagnostic.pointers.length, 0);
    const scope = input.selection.kind === 'full'
        ? { kind: 'full', specifications: input.specificationSources }
        : {
            kind: 'focused',
            requested: input.selection.requested,
            selected: input.selection.selected,
            support: input.selection.support,
        };
    return {
        format: CLI_CHECK_REPORT_FORMAT,
        version: CLI_CHECK_REPORT_VERSION,
        command: 'check',
        status: input.diagnostics.length > 0 || input.qualificationFailed ? 'fail' : 'pass',
        evidence: {
            repository: input.repository,
            inventory: input.inventory,
            snapshot: input.snapshot,
        },
        scope,
        qualificationFailed: input.qualificationFailed,
        diagnostics: input.diagnostics,
        summary: {
            specifications: scope.kind === 'full'
                ? scope.specifications.length
                : scope.selected.length + scope.support.length,
            diagnosticCauses: input.diagnostics.length,
            diagnosticOccurrences,
        },
    };
}
export function encodeCliCheckReport(report) {
    return JSON.stringify(report, null, 2);
}
//# sourceMappingURL=check-report.js.map