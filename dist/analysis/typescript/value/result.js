/**
 * Project observed values without strengthening incomplete evidence.
 * Exhaustive alternatives collapse only when their projections are equivalent.
 * The default equivalence is Object.is; object projections need an explicit comparator.
 *
 * This returns a value result, not an evaluation receipt: limits and reuse metadata
 * belong to the original proof and are never copied to the derived result.
 */
export function mapValueResult(result, project, options = {}) {
    const evidence = result.evidence;
    switch (result.kind) {
        case 'known':
            return { kind: 'known', value: project(result.value), evidence };
        case 'unknown':
            return {
                kind: 'unknown',
                ...(result.candidates === undefined ? {} : { candidates: result.candidates.map(project) }),
                reasons: result.reasons,
                evidence,
            };
        case 'ambiguous': {
            const values = result.values.map(project);
            const equals = options.equals ?? Object.is;
            if (values.length > 0 && values.every((value) => equals(values[0], value))) {
                return { kind: 'known', value: values[0], evidence };
            }
            return { kind: 'ambiguous', values, reasons: result.reasons, evidence };
        }
        case 'unsupported':
            return { kind: 'unsupported', construct: result.construct, evidence };
    }
}
//# sourceMappingURL=result.js.map