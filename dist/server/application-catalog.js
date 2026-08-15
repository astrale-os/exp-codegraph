import { basename, resolve } from 'node:path';
import { deriveAnalysisId } from '../analysis/index.js';
import { createTypeScriptFactReader, } from '../analysis/typescript/index.js';
import { APPLICATION_CONTEXT_FACT_NAMESPACE, APPLICATION_LAYOUT_FACT_NAMESPACE, APPLICATION_TEST_FACT_NAMESPACE, } from '../application/observation/index.js';
import { MODULE_STRUCTURE_PROFILE_ID, } from '../conformance/index.js';
import { renderMarkdownDocument } from '../markdown/render.js';
import { sourceRevision } from '../source/file.js';
import { loadHistoryResource } from '../specification/module/history.js';
import { loadModuleIcon } from '../specification/module/icon.js';
/**
 * Project one generation-pinned V2 application reader into the current browser presentation.
 * This adapter owns no semantic decisions: all observations come from pinned facts or verified
 * source reads, and the mutable V1 catalog builder is never invoked.
 */
export async function projectApplicationCatalog(root, reader) {
    const specs = await Promise.all(reader.snapshot.specifications.map((specification) => projectSpecification(root, reader, specification.source)));
    return {
        specs,
        diagnostics: [...reader.snapshot.diagnostics],
        ...(reader.snapshot.selection.kind === 'focused'
            ? {
                selection: {
                    requested: reader.snapshot.selection.requested,
                    selectedSources: reader.snapshot.selection.selected,
                    selectedModuleIds: specs
                        .filter((specification) => reader.snapshot.selection.kind === 'focused' &&
                        reader.snapshot.selection.selected.includes(specification.source))
                        .flatMap((specification) => specification.modules.map((module) => module.id)),
                    supportModuleIds: specs
                        .filter((specification) => reader.snapshot.selection.kind === 'focused' &&
                        reader.snapshot.selection.support.includes(specification.source))
                        .flatMap((specification) => specification.modules.map((module) => module.id)),
                },
            }
            : {}),
    };
}
async function projectSpecification(root, reader, source) {
    const specification = reader.snapshot.specifications.find((candidate) => candidate.source === source);
    if (!specification)
        throw new Error(`Application specification disappeared: ${source}`);
    const subject = specification.module.id;
    const [layoutFact, testFact, contextFact, moduleFact] = await Promise.all([
        oneFact(reader, APPLICATION_LAYOUT_FACT_NAMESPACE, subject),
        oneFact(reader, APPLICATION_TEST_FACT_NAMESPACE, subject),
        oneFact(reader, APPLICATION_CONTEXT_FACT_NAMESPACE, subject),
        oneTypeScriptModuleFact(reader, subject),
    ]);
    const context = await projectContext(root, reader, contextFact?.payload);
    const qualification = reader.snapshot.qualifications.find((candidate) => candidate.specification.id === specification.id);
    const binding = moduleFact ? implementationBinding(moduleFact.payload) : undefined;
    const contract = specification.module.api
        ? presentationContract(specification.module.id, moduleFact?.payload)
        : undefined;
    const moduleDiagnostics = moduleFact?.payload.issues.map(issueDiagnostic) ?? [];
    const laws = withLawEvidence(specification.laws, testFact?.payload);
    const states = withStateEvidence(specification.states, testFact?.payload);
    const layout = projectLayout(specification.layout, layoutFact?.payload);
    const verification = qualification && hasCompilerQualification(qualification)
        ? projectQualification(qualification)
        : undefined;
    const revision = specification.revision;
    return {
        title: specification.title,
        source: specification.source,
        modules: [
            {
                id: specification.module.id,
                name: specification.module.name,
                declarationPointer: specification.module.declarationPointer,
                ...(specification.module.api ? { api: specification.module.api } : {}),
                ports: [...specification.module.ports],
                ...(binding ? { binding } : {}),
                packages: [...specification.module.packages],
                diagnostics: moduleDiagnostics,
                ...(moduleFact
                    ? { code: presentationCode(moduleFact.payload, reader.snapshot.statistics) }
                    : {}),
                ...(contract ? { contract } : {}),
            },
        ],
        schemas: specification.schemas,
        examples: specification.examples,
        diagnostics: [
            ...specification.diagnostics,
            ...(layoutFact?.payload.diagnostics ?? []),
            ...(testFact?.payload.diagnostics ?? []),
        ],
        specRevision: specification.revision,
        verificationRevision: revision,
        root: specification.root,
        ...(specification.module.code ? { code: specification.module.code } : {}),
        ...(context.icon ? { icon: context.icon } : {}),
        ...(specification.module.internal ? { internal: specification.module.internal } : {}),
        capabilities: specification.capabilities,
        flows: specification.flows,
        laws,
        states,
        ...(specification.limits ? { limits: specification.limits } : {}),
        ...(layout ? { layout } : {}),
        benchmarks: specification.benchmarks,
        packages: specification.packages,
        packagePatterns: specification.packagePatterns,
        ...(context.architecture ? { architecture: context.architecture } : {}),
        sourceReferences: specification.sourceReferences,
        history: context.history,
        historyRevision: sourceRevision(context.history.map((resource) => resource.revision).join('\0')),
        historyDiagnostics: context.diagnostics,
        contracts: contract ? [contract.id] : [],
        ...(verification ? { verification } : {}),
    };
}
async function oneFact(reader, namespace, subject) {
    const matches = [];
    for (const universe of reader.snapshot.analysis?.universes ?? []) {
        const query = await reader.query(universe);
        try {
            const page = await query.facts({ namespaces: [namespace], subjects: [subject] }, { limit: 2 });
            matches.push(...page.facts);
        }
        finally {
            await query.dispose();
        }
    }
    if (matches.length > 1) {
        throw new Error(`Expected at most one ${namespace} fact for ${subject}; found ${matches.length}.`);
    }
    return matches[0];
}
async function oneTypeScriptModuleFact(reader, subject) {
    const matches = [];
    for (const universe of reader.snapshot.analysis?.universes ?? []) {
        const query = await reader.query(universe);
        try {
            const page = await createTypeScriptFactReader(query).facts('module', { subjects: [subject] }, { limit: 2 });
            matches.push(...page.facts);
        }
        finally {
            await query.dispose();
        }
    }
    if (matches.length > 1) {
        throw new Error(`Expected at most one TypeScript module fact for ${subject}; found ${matches.length}.`);
    }
    return matches[0];
}
function implementationBinding(fact) {
    return {
        project: fact.target.project,
        root: fact.target.root,
        entrypoint: fact.target.entrypoint,
        ...(fact.target.facades.length ? { facades: fact.target.facades } : {}),
        ...(fact.target.aliases.length ? { aliases: fact.target.aliases } : {}),
        ...(fact.target.internals.length ? { internals: fact.target.internals } : {}),
    };
}
function presentationContract(module, fact) {
    const imports = fact?.dependencies.flatMap((dependency) => dependency.occurrences.flatMap((occurrence) => occurrence.declaration
        ? [{
                key: occurrence.declaration,
                source: dependency.targetModule,
                pointer: '',
                kind: 'value',
                name: occurrence.declaration,
            }]
        : [])) ?? [];
    return {
        id: fact?.target.id ?? module,
        imports,
    };
}
function presentationCode(fact, statistics) {
    const dependencies = fact.dependencies.flatMap((dependency) => {
        const occurrence = dependency.occurrences[0];
        if (!occurrence)
            return [];
        return [{
                id: dependency.id,
                sourceFile: dependency.sourceFile,
                targetFile: dependency.targetFile,
                sourceModule: dependency.sourceModule,
                targetModule: dependency.targetModule,
                kind: dependency.kind === 'api' ? 'type' : dependency.kind,
                typeOnly: occurrence.typeOnly,
                specifier: occurrence.specifier,
                external: dependency.targetModule.startsWith('package:'),
                location: occurrence.location,
            }];
    });
    const paths = new Set(fact.files);
    const statisticsByPath = new Map(statistics.files.filter((file) => paths.has(file.path)).map((file) => [file.path, file]));
    const entrypoints = new Set([
        fact.target.entrypoint,
        ...fact.target.facades,
        ...fact.target.aliases,
        ...fact.target.internals,
    ]);
    const reachable = reachableFiles(entrypoints, paths, dependencies);
    const inbound = new Map();
    const outbound = new Map();
    for (const dependency of dependencies) {
        increment(outbound, dependency.sourceFile);
        if (dependency.targetFile)
            increment(inbound, dependency.targetFile);
    }
    const files = [...paths].sort().map((path) => {
        const observed = statisticsByPath.get(path);
        return {
            path,
            module: modulePath(fact.target.root, path),
            entrypoint: entrypoints.has(path),
            reachable: reachable.has(path),
            lines: observed
                ? {
                    total: observed.lines.physical,
                    code: observed.lines.code,
                    comment: observed.lines.comment,
                    blank: observed.lines.blank,
                    ...(observed.lines.unclassified
                        ? { unclassified: observed.lines.unclassified }
                        : {}),
                }
                : { total: 0, code: 0, comment: 0, blank: 0 },
            inbound: inbound.get(path) ?? 0,
            outbound: outbound.get(path) ?? 0,
        };
    });
    const lineTotals = files.reduce((total, file) => ({
        total: total.total + file.lines.total,
        code: total.code + file.lines.code,
        comment: total.comment + file.lines.comment,
        blank: total.blank + file.lines.blank,
        unclassified: (total.unclassified ?? 0) + (file.lines.unclassified ?? 0),
    }), { total: 0, code: 0, comment: 0, blank: 0, unclassified: 0 });
    const codeCounts = files.map((file) => file.lines.code).sort((left, right) => left - right);
    const largest = [...files].sort((left, right) => right.lines.code - left.lines.code || left.path.localeCompare(right.path))[0];
    const missingStatistics = files.filter((file) => !statisticsByPath.has(file.path));
    const issues = [
        ...fact.issues,
        ...(missingStatistics.length
            ? [{
                    code: 'REPOSITORY_STATISTICS_MISSING',
                    message: `No pinned repository statistics exist for ${missingStatistics.length} module files.`,
                }]
            : []),
        {
            code: 'TYPESCRIPT_CYCLE_MATERIALIZATION_PENDING',
            message: 'Dependency cycles are not materialized by the current compiler fact schema.',
        },
    ];
    return {
        status: 'partial',
        scope: {
            project: fact.target.project,
            root: fact.target.root,
            entrypoint: fact.target.entrypoint,
            ...(fact.target.facades.length ? { facades: fact.target.facades } : {}),
            aliases: fact.target.aliases,
            ...(fact.target.internals.length ? { internals: fact.target.internals } : {}),
        },
        summary: {
            files: files.length,
            reachableFiles: files.filter((file) => file.reachable).length,
            detachedFiles: files.filter((file) => !file.reachable).length,
            modules: new Set(files.map((file) => file.module)).size,
            lines: lineTotals,
            averageCodeLines: round(files.length ? lineTotals.code / files.length : 0),
            medianCodeLines: percentile(codeCounts, 0.5),
            p95CodeLines: percentile(codeCounts, 0.95),
            ...(largest ? { largestFile: { path: largest.path, codeLines: largest.lines.code } } : {}),
            internalDependencies: dependencies.filter((dependency) => !dependency.external).length,
            externalDependencies: dependencies.filter((dependency) => dependency.external).length,
            runtimeCycles: 0,
            typeCycles: 0,
        },
        files,
        modules: [],
        dependencies,
        cycles: [],
        issues,
    };
}
function reachableFiles(entrypoints, files, dependencies) {
    const outgoing = new Map();
    for (const dependency of dependencies) {
        if (dependency.external || !dependency.targetFile || !files.has(dependency.targetFile))
            continue;
        const targets = outgoing.get(dependency.sourceFile) ?? [];
        targets.push(dependency.targetFile);
        outgoing.set(dependency.sourceFile, targets);
    }
    const reached = new Set();
    const pending = [...entrypoints].filter((file) => files.has(file)).sort();
    while (pending.length) {
        const file = pending.shift();
        if (reached.has(file))
            continue;
        reached.add(file);
        pending.push(...(outgoing.get(file) ?? []).filter((target) => !reached.has(target)).sort());
    }
    return reached;
}
function modulePath(root, file) {
    const prefix = root === '.' ? '' : `${root.replace(/\/$/u, '')}/`;
    const relative = prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file;
    const segments = relative.split('/');
    return segments.length <= 1 ? '.' : segments.slice(0, -1).join('/') || '.';
}
function increment(values, key) {
    values.set(key, (values.get(key) ?? 0) + 1);
}
function percentile(values, ratio) {
    if (!values.length)
        return 0;
    return values[Math.ceil(values.length * ratio) - 1] ?? values.at(-1) ?? 0;
}
function round(value) {
    return Math.round(value * 100) / 100;
}
function issueDiagnostic(issue) {
    return {
        code: issue.code,
        message: issue.message,
        file: issue.location?.file ?? '.',
        line: issue.location?.line ?? 1,
        column: issue.location?.column ?? 1,
    };
}
function withLawEvidence(resources, fact) {
    const evidence = new Map(fact?.laws.map((entry) => [entry.id, entry.evidence]) ?? []);
    return resources.map((resource) => ({
        ...resource,
        definitions: resource.definitions.map((definition) => ({
            ...definition,
            testEvidence: evidence.get(definition.id) ?? [],
        })),
    }));
}
function withStateEvidence(resources, fact) {
    const evidence = new Map(fact?.states.map((entry) => [entry.id, entry.evidence]) ?? []);
    return resources.map((resource) => ({
        ...resource,
        definitions: resource.definitions.map((definition) => ({
            ...definition,
            testEvidence: evidence.get(definition.exportName) ?? [],
        })),
    }));
}
function projectLayout(resource, observation) {
    if (!resource || !observation?.declared)
        return;
    return {
        ...resource,
        exact: observation.exact,
        ignore: observation.ignore,
        observation: {
            entries: observation.entries,
            additional: observation.additional,
            revision: observation.revision ?? resource.revision,
        },
    };
}
async function projectContext(root, reader, fact) {
    if (!fact)
        return { history: [], diagnostics: [] };
    const diagnostics = [];
    let architecture;
    if (fact.architecture) {
        const read = await reader.source({ source: fact.architecture.source, revision: fact.architecture.revision });
        if (read.status === 'current') {
            architecture = {
                ref: './architecture.md',
                document: renderMarkdownDocument(read.path, read.text),
            };
        }
        else
            diagnostics.push(staleContextDiagnostic(fact.architecture));
    }
    const icon = fact.icon ? await loadPinnedIcon(root, fact.icon, diagnostics) : undefined;
    const history = [];
    for (const resource of fact.history) {
        const loaded = await loadHistoryResource(moduleFile(root, resource));
        diagnostics.push(...loaded.diagnostics);
        if (!loaded.resource)
            continue;
        if (!matchesRevision(resource, loaded.resource.revision)) {
            diagnostics.push(staleContextDiagnostic(resource));
            continue;
        }
        history.push(loaded.resource);
    }
    return {
        ...(architecture ? { architecture } : {}),
        ...(icon ? { icon } : {}),
        history,
        diagnostics,
    };
}
async function loadPinnedIcon(root, resource, diagnostics) {
    const loaded = await loadModuleIcon(moduleFile(root, resource));
    diagnostics.push(...loaded.diagnostics);
    if (!loaded.resource)
        return;
    if (!matchesRevision(resource, loaded.resource.revision)) {
        diagnostics.push(staleContextDiagnostic(resource));
        return;
    }
    return loaded.resource;
}
function moduleFile(root, resource) {
    return {
        absolute: resolve(root, resource.path),
        source: resource.path,
        relative: basename(resource.path),
    };
}
function matchesRevision(resource, digest) {
    return deriveAnalysisId('source-revision', `${resource.source}`, {
        digest,
        encoding: 'bytes',
    }) === resource.revision;
}
function staleContextDiagnostic(resource) {
    return {
        code: 'APPLICATION_CONTEXT_STALE',
        message: 'Context resource changed after the application snapshot was published.',
        file: resource.path,
        line: 1,
        column: 1,
    };
}
function hasCompilerQualification(qualification) {
    return qualification.profiles.some((profile) => profile.id === MODULE_STRUCTURE_PROFILE_ID);
}
function projectQualification(qualification) {
    const profiles = qualification.profiles.map((profile) => ({
        id: profile.id,
        provider: `typespec-v2@${profile.version}`,
        status: verificationStatus(profile.status),
        rules: profile.rules.map((rule) => ({
            id: rule.rule,
            status: verificationStatus(rule.status),
            diagnostics: rule.diagnostics.map((diagnostic) => ({
                code: diagnostic.code,
                message: diagnostic.message,
                severity: diagnostic.severity,
                ...(diagnostic.actual !== undefined ? { actual: diagnostic.actual } : {}),
                ...(diagnostic.expected !== undefined ? { expected: diagnostic.expected } : {}),
                ...(diagnostic.hint ? { hint: diagnostic.hint } : {}),
            })),
        })),
        coverage: {
            forward: coverage(profile.coverage.forward),
            inverse: coverage(profile.coverage.inverse),
        },
    }));
    return {
        status: verificationStatus(qualification.status),
        profiles,
        rules: profiles.flatMap((profile) => profile.rules),
        dependencies: [],
        durationMs: 0,
    };
}
function verificationStatus(status) {
    return status === 'indeterminate' ? 'idle' : status;
}
function coverage(value) {
    return {
        ...value,
        percent: value.total ? (value.matched / value.total) * 100 : null,
        unmatched: [],
    };
}
//# sourceMappingURL=application-catalog.js.map