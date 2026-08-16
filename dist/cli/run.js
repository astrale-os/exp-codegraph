import { MODULE_LAYOUT_PROFILE_ID, MODULE_SCHEMA_PROFILE_ID, MODULE_TEST_EVIDENCE_PROFILE_ID, SPECIFICATION_VALIDITY_PROFILE_ID, } from '../conformance/index.js';
import { USAGE } from './parse.js';
import { createDevStartupProgress } from './progress.js';
import { printQualificationProfile, printQualificationRule, printQualificationSummary, qualificationDiagnostics, } from './qualification-report.js';
import { printDiagnostic } from './report.js';
const CHECK_PROFILES = [
    SPECIFICATION_VALIDITY_PROFILE_ID,
    MODULE_LAYOUT_PROFILE_ID,
    MODULE_SCHEMA_PROFILE_ID,
    MODULE_TEST_EVIDENCE_PROFILE_ID,
];
const TEST_PROFILES = [SPECIFICATION_VALIDITY_PROFILE_ID, MODULE_TEST_EVIDENCE_PROFILE_ID];
export async function runCommand(command, services, output) {
    if (command.name === 'help') {
        output.out(USAGE);
        return { exitCode: command.successful ? 0 : 2 };
    }
    if (command.name === 'version') {
        output.out(await services.version());
        return { exitCode: 0 };
    }
    if (command.name === 'init') {
        const api = await services.initializeModule(command.root);
        output.out(`Initialized ${api}`);
        return { exitCode: 0 };
    }
    if (command.name === 'dev') {
        const progress = createDevStartupProgress(output);
        try {
            const server = await services.startDev({
                ...command,
                telemetry: (event) => {
                    if (!progress.onTelemetry(event))
                        reportDevTelemetry(output, event);
                },
            });
            progress.succeed();
            output.out(`SPEC_SERVER_URL=${server.url}`);
            return { exitCode: 0, server };
        }
        catch (error) {
            progress.fail();
            throw error;
        }
    }
    const changed = command.name === 'changed' || (command.name === 'test' && command.changed)
        ? await services.changedSpecificationScope(command.root, command.base)
        : undefined;
    if (changed?.kind === 'none') {
        output.out(`No specification-affecting changes found against ${changed.base}.`);
        return { exitCode: 0 };
    }
    if (changed)
        reportChangedScope(output, changed, command.quiet);
    if (command.name === 'changed' && command.scopeOnly)
        return { exitCode: 0 };
    const cache = 'cache' in command ? command.cache : true;
    const application = await services.createApplication(command.root, cache);
    let reader;
    try {
        const refreshed = await application.refresh(refreshOptions(command, changed));
        const snapshot = refreshed.snapshot;
        const diagnostics = applicationDiagnostics(snapshot);
        if (command.name === 'check' || command.name === 'changed') {
            for (const diagnostic of diagnostics)
                printDiagnostic(output, diagnostic);
            reportCheck(output, command, changed, snapshot, diagnostics.length);
            return { exitCode: applicationFailed(snapshot, diagnostics) ? 1 : 0 };
        }
        if (command.name === 'test') {
            for (const diagnostic of diagnostics)
                printDiagnostic(output, diagnostic);
            if (applicationFailed(snapshot, diagnostics)) {
                output.out(`Evidence tests not started: ${diagnostics.length} specification diagnostic${diagnostics.length === 1 ? '' : 's'}.`);
                return { exitCode: 1 };
            }
            reader = await application.open(snapshot.id);
            const scope = command.changed ? 'changed' : command.select.length ? 'selected' : 'all';
            const plan = await services.planEvidenceTests(command.root, reader, scope);
            return executeEvidenceCommand(command, services, output, plan);
        }
        for (const diagnostic of snapshot.diagnostics)
            printDiagnostic(output, diagnostic);
        const qualifications = selectedQualifications(snapshot);
        for (const qualification of qualifications) {
            if (command.details) {
                for (const profile of qualification.profiles) {
                    printQualificationProfile(output, qualification.specification.source, profile);
                }
                for (const rule of qualification.profiles.flatMap((profile) => profile.rules)) {
                    printQualificationRule(output, qualification, rule);
                }
            }
            else {
                printQualificationSummary(output, qualification);
            }
        }
        const counts = qualificationCounts(qualifications);
        const expected = selectedSpecificationSources(snapshot).length;
        const total = counts.pass + counts.fail + counts.idle + counts.error;
        const measured = total === expected ? `${total}` : `${total} of ${expected}`;
        output.out(`Verified ${measured} specification${expected === 1 ? '' : 's'}: ${counts.pass} passed, ${counts.fail} failed, ${counts.idle} idle, ${counts.error} errors.`);
        if (!command.details && counts.fail + counts.idle + counts.error > 0) {
            output.out('Run the same verify command with --details for complete expected/actual evidence.');
        }
        const allPass = counts.pass === expected;
        if (command.requirePass && !allPass) {
            output.error(`Pass-required verification expected ${expected} passing specification${expected === 1 ? '' : 's'}; found ${counts.pass}.`);
        }
        return {
            exitCode: snapshot.diagnostics.length || !allPass ? 1 : 0,
        };
    }
    finally {
        await reader?.dispose();
        await application.dispose();
    }
}
function reportDevTelemetry(output, event) {
    if (event.phase === 'store.selection') {
        output.out(`CODEGRAPH_STORE=${String(event.metrics?.backend ?? 'unknown')}` +
            (event.metrics?.fallback === true ? ' fallback=true' : ''));
        return;
    }
    if (event.phase !== 'application.refresh' && event.phase !== 'application.verification')
        return;
    const durationMs = event.durationNs === undefined ? 0 : event.durationNs / 1_000_000;
    const metrics = event.metrics ?? {};
    output.out(`CODEGRAPH_${event.phase === 'application.verification' ? 'VERIFY' : 'REFRESH'} duration_ms=${durationMs.toFixed(1)} changed=${String(metrics.changedPaths ?? 0)}` +
        ` refreshed_specs=${String(metrics.refreshedSpecifications ?? 0)}` +
        ` heap_mib=${mebibytes(metrics.heapUsedBytes)} rss_mib=${mebibytes(metrics.rssBytes)}`);
}
function mebibytes(value) {
    return typeof value === 'number' ? (value / (1024 * 1024)).toFixed(1) : 'unknown';
}
function refreshOptions(command, changed) {
    if (command.name === 'check' || command.name === 'changed') {
        const select = command.name === 'changed' && changed?.kind === 'selected'
            ? changed.targets
            : command.name === 'check'
                ? command.select
                : [];
        return {
            qualify: true,
            compilerAnalysis: false,
            requestedProfiles: CHECK_PROFILES,
            exclude: command.exclude,
            select,
            focused: select.length > 0,
            includeDependents: command.name === 'changed',
            requireCompleteLayout: command.requireCompleteLayout,
            requireExactLayout: command.name === 'check' && command.requireExactLayout,
        };
    }
    if (command.name === 'test') {
        const select = command.changed && changed?.kind === 'selected' ? changed.targets : command.select;
        return {
            qualify: true,
            compilerAnalysis: false,
            requestedProfiles: TEST_PROFILES,
            select,
            focused: select.length > 0,
            includeDependents: command.changed,
        };
    }
    return {
        qualify: true,
        compilerAnalysis: true,
        select: command.select,
        focused: command.select.length > 0,
        schemaRoots: command.schemaRoots,
    };
}
function applicationDiagnostics(snapshot) {
    return deduplicateDiagnostics([
        ...snapshot.diagnostics,
        ...snapshot.qualifications.flatMap(qualificationDiagnostics),
    ]);
}
function applicationFailed(snapshot, diagnostics) {
    return diagnostics.length > 0 || snapshot.qualifications.some((value) => value.status !== 'pass');
}
function reportCheck(output, command, changed, snapshot, diagnostics) {
    const selected = selectedSpecificationSources(snapshot);
    const support = snapshot.selection.kind === 'focused' ? snapshot.selection.support.length : 0;
    const checked = snapshot.selection.kind === 'focused' ? selected.length + support : snapshot.specifications.length;
    const suffix = `${diagnostics} diagnostic${diagnostics === 1 ? '' : 's'}.`;
    if (command.name === 'changed' && changed?.kind === 'full') {
        output.out(`Checked full catalog: ${checked} specification${checked === 1 ? '' : 's'}, ${suffix}`);
    }
    else if (command.name === 'changed') {
        output.out(`Checked affected closure: ${checked} specification${checked === 1 ? '' : 's'} (${selected.length} changed + ${support} support), ${suffix}`);
    }
    else {
        const prefix = command.select.length ? 'Checked selected' : 'Checked';
        const supportText = command.select.length && support ? ` (+${support} support)` : '';
        output.out(`${prefix} ${command.select.length ? selected.length : checked} specification${(command.select.length ? selected.length : checked) === 1 ? '' : 's'}${supportText}: ${suffix}`);
    }
}
async function executeEvidenceCommand(command, services, output, plan) {
    const fileCount = plan.groups.reduce((total, group) => total + group.files.length, 0);
    if (!plan.active) {
        output.out(`No active attached evidence tests found (${plan.skipped} skipped, ${plan.todo} todo).`);
        output.out(command.changed
            ? 'Changed-only evidence is advisory; pnpm test remains authoritative.'
            : 'Attached evidence is not the full test suite; pnpm test remains authoritative.');
        return { exitCode: 0 };
    }
    output.out(`Testing ${plan.active} active evidence declaration${plan.active === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'} across ${plan.groups.length} package${plan.groups.length === 1 ? '' : 's'} (${plan.skipped} skipped, ${plan.todo} todo).`);
    const result = await services.executeEvidenceTests(command.root, plan, command.quiet
        ? undefined
        : (group) => output.out(`Testing ${group.packageName}: ${group.files.length} file${group.files.length === 1 ? '' : 's'}, ${group.evidenceCount} evidence declaration${group.evidenceCount === 1 ? '' : 's'}.`));
    output.out(`Tested ${plan.groups.length} package${plan.groups.length === 1 ? '' : 's'}: ${result.passed} passed, ${result.failed} failed.`);
    output.out(command.changed
        ? 'Changed-only evidence is advisory; pnpm test remains authoritative.'
        : 'Attached evidence is not the full test suite; pnpm test remains authoritative.');
    return { exitCode: result.failed ? 1 : 0 };
}
function selectedQualifications(snapshot) {
    const selected = new Set(selectedSpecificationSources(snapshot));
    return snapshot.qualifications.filter((value) => selected.has(value.specification.source));
}
function selectedSpecificationSources(snapshot) {
    return snapshot.selection.kind === 'full'
        ? snapshot.specifications.map((value) => value.source)
        : snapshot.selection.selected;
}
function qualificationCounts(values) {
    return values.reduce((counts, value) => {
        if (value.status === 'pass')
            counts.pass += 1;
        else if (value.status === 'fail')
            counts.fail += 1;
        else if (value.status === 'indeterminate')
            counts.idle += 1;
        else
            counts.error += 1;
        return counts;
    }, { pass: 0, fail: 0, idle: 0, error: 0 });
}
function reportChangedScope(output, changed, quiet) {
    const scope = changed.kind === 'selected'
        ? `${changed.targets.length} changed module${changed.targets.length === 1 ? '' : 's'}`
        : 'full catalog';
    output.out(`Changed scope against ${changed.base}: ${changed.files.length} file${changed.files.length === 1 ? '' : 's'}, ${scope}.`);
    if (changed.kind === 'full' && !quiet) {
        const shown = changed.triggers.slice(0, 3);
        const remaining = changed.triggers.length - shown.length;
        output.out(`Full catalog scope triggered by ${shown.join(', ')}${remaining ? ` (+${remaining} more)` : ''}.`);
    }
}
function deduplicateDiagnostics(values) {
    const seen = new Set();
    return values.filter((value) => {
        const key = JSON.stringify([
            value.code,
            value.message,
            value.file,
            value.line,
            value.column,
            value.pointer,
        ]);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
//# sourceMappingURL=run.js.map