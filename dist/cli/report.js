export function printDiagnostic(output, diagnostic) {
    const pointer = diagnostic.pointer ? ` ${terminalText(diagnostic.pointer)}` : '';
    output.error(`${terminalText(diagnostic.file)}:${diagnostic.line}:${diagnostic.column} [${terminalText(diagnostic.code)}]${pointer} ${terminalText(diagnostic.message)}`);
}
export function printVerificationRule(output, source, rule) {
    if (rule.status === 'pass' && rule.diagnostics.length === 0)
        return;
    if (rule.status === 'idle' && rule.diagnostics.length === 0) {
        output.out(`${terminalText(source)} [${terminalText(rule.id)}] idle`);
        return;
    }
    for (const diagnostic of rule.diagnostics) {
        printVerificationDiagnostic(output, source, rule, diagnostic);
    }
}
export function printVerificationProfile(output, source, profile) {
    if (!profile.target && !profile.coverage)
        return;
    const target = profile.target ? ` target=${profile.target.id}` : '';
    const coverage = profile.coverage
        ? ` forward=${profile.coverage.forward.matched}/${profile.coverage.forward.total} inverse=${profile.coverage.inverse.matched}/${profile.coverage.inverse.total}`
        : '';
    const message = `${terminalText(source)} [${terminalText(profile.id)}] provider=${terminalText(profile.provider)}${terminalText(target)} status=${profile.status}${terminalText(coverage)}`;
    const write = profile.status === 'fail' || profile.status === 'error' ? output.error : output.out;
    write(message);
}
/** Print a bounded, causal overview while retaining full evidence behind --details. */
export function printVerificationSummary(output, source, verification) {
    if (verification.status === 'pass')
        return;
    const failing = verification.profiles.filter((profile) => profile.status !== 'pass');
    const diagnosticCount = failing.reduce((count, profile) => count + profile.rules.reduce((total, rule) => total + rule.diagnostics.length, 0), 0);
    output.error(`${terminalText(source)} ${verification.status.toUpperCase()} — ${diagnosticCount} diagnostic${diagnosticCount === 1 ? '' : 's'} in ${failing.length} profile${failing.length === 1 ? '' : 's'}`);
    for (const profile of failing) {
        const coverage = profile.coverage
            ? ` forward=${profile.coverage.forward.matched}/${profile.coverage.forward.total} inverse=${profile.coverage.inverse.matched}/${profile.coverage.inverse.total}`
            : '';
        output.error(`  ${terminalText(profile.id)} ${profile.status}${coverage}`);
        const groups = groupedVerificationDiagnostics(profile.rules);
        if (!groups.length)
            output.error('    No diagnostic details were provided.');
        for (const group of groups) {
            const location = group.diagnostic.location;
            const file = location?.file ?? location?.external ?? source;
            const position = `${terminalText(file)}:${location?.line ?? 1}:${location?.column ?? 1}`;
            output.error(`    ${terminalText(group.code)} ×${group.count} — ${position} ${terminalText(group.diagnostic.message)}`);
        }
    }
}
function groupedVerificationDiagnostics(rules) {
    const groups = new Map();
    for (const diagnostic of rules.flatMap((rule) => rule.diagnostics)) {
        const code = diagnostic.code ?? 'VERIFICATION_DIAGNOSTIC';
        const existing = groups.get(code);
        if (existing)
            existing.count += 1;
        else
            groups.set(code, { code, count: 1, diagnostic });
    }
    return [...groups.values()].sort((left, right) => compare(left.code, right.code));
}
function printVerificationDiagnostic(output, source, rule, diagnostic) {
    const location = diagnostic.location;
    const file = location?.file ?? location?.external ?? source;
    const line = location?.line ?? 1;
    const column = location?.column ?? 1;
    const pointer = location?.pointer ? ` ${terminalText(location.pointer)}` : '';
    const code = diagnostic.code ? `:${terminalText(diagnostic.code)}` : '';
    const message = `${terminalText(file)}:${line}:${column} [${terminalText(rule.id)}${code}]${pointer} ${terminalText(diagnostic.message)}`;
    const write = rule.status === 'idle' || diagnostic.severity === 'info' ? output.out : output.error;
    write(message);
    if (diagnostic.expected !== undefined) {
        write(`  expected: ${terminalText(displayValue(diagnostic.expected))}`);
    }
    if (diagnostic.actual !== undefined) {
        write(`  actual: ${terminalText(displayValue(diagnostic.actual))}`);
    }
    if (diagnostic.hint)
        write(`  hint: ${terminalText(diagnostic.hint)}`);
    for (const related of diagnostic.related ?? []) {
        write(`  related: ${terminalText(related.file ?? related.external ?? source)}:${related.line ?? 1}:${related.column ?? 1}${related.pointer ? ` ${terminalText(related.pointer)}` : ''}${related.label ? ` ${terminalText(related.label)}` : ''}`);
    }
}
function displayValue(value) {
    return typeof value === 'string' ? value : JSON.stringify(value);
}
export function terminalText(value) {
    let result = '';
    for (const character of value) {
        const code = character.codePointAt(0);
        const unsafe = code <= 0x1f ||
            (code >= 0x7f && code <= 0x9f) ||
            code === 0x61c ||
            code === 0x200e ||
            code === 0x200f ||
            (code >= 0x2028 && code <= 0x202e) ||
            (code >= 0x2066 && code <= 0x2069);
        result += unsafe
            ? code <= 0xff
                ? `\\x${code.toString(16).padStart(2, '0')}`
                : `\\u{${code.toString(16)}}`
            : character;
    }
    return result;
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=report.js.map