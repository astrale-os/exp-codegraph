import { resolve } from 'node:path';
import { deriveAnalysisId, factShardDigest, generationIdentity, shardReference, } from '../../analysis/index.js';
import { validateModuleSchemaCatalog } from '../../schema/catalog.js';
import { compileLayout, observeLayout } from '../../specification/module/layout.js';
import { resolveTestEvidence } from '../../specification/module/test-evidence.js';
import { APPLICATION_LAYOUT_FACT_NAMESPACE, APPLICATION_CONTEXT_FACT_NAMESPACE, APPLICATION_SCHEMA_FACT_NAMESPACE, APPLICATION_TEST_FACT_NAMESPACE, } from './model.js';
import { indexApplicationObservationInventory, } from './materialize.optimization.js';
const OBSERVATION_PASS = deriveAnalysisId('pass', 'astrale.typespec.application-observation', { version: 1 });
const OBSERVATION_PRODUCER = {
    id: deriveAnalysisId('producer', 'astrale.typespec.application-observation', { version: 1 }),
    name: 'astrale.typespec.application-observation',
    version: '1.0.0',
    protocolVersion: 1,
};
/** Materialize repository-scoped TypeSpec observations into one portable universe. */
export async function materializeApplicationObservations(options) {
    options.signal?.throwIfAborted();
    const universe = deriveAnalysisId('project-universe', 'astrale.typespec.repository-observation', {
        repository: options.inventory.repository,
        producer: OBSERVATION_PRODUCER,
    });
    const provisional = deriveAnalysisId('generation', 'astrale.typespec.observation.provisional', {
        inventory: options.inventory.revision,
    });
    const current = await options.store.current(universe);
    const currentManifest = current
        ? await withManifest(options.store, universe, current.id)
        : [];
    const currentByKey = new Map(currentManifest.map((entry) => [entry.key, entry]));
    const requested = options.refresh ? new Set(options.refresh) : undefined;
    const inventoryIndex = indexApplicationObservationInventory(options.inventory);
    const shards = [];
    const retained = [];
    const schemaDependencies = options.schemaDependencies ?? [];
    const schemaDiagnostics = validateModuleSchemaCatalog(options.root, [
        ...options.specifications.flatMap((specification) => specification.schemas),
        ...schemaDependencies,
    ]);
    const ownedSchemaSources = new Set(options.specifications.flatMap((specification) => specification.schemas.map((resource) => resource.source)));
    const globalDiagnostics = schemaDiagnostics.filter((diagnostic) => !ownedSchemaSources.has(diagnostic.file));
    const sourceManifest = deriveAnalysisId('source-manifest', 'astrale.typespec.application-observation', {
        inventory: options.inventory.revision,
        schemaDependencies: schemaDependencies.map((resource) => [
            resource.source,
            resource.revision,
        ]),
    });
    const expectedKeys = options.specifications.flatMap(observationKeys).sort();
    if ((requested === undefined || requested.size === 0) &&
        current?.sourceManifest === sourceManifest &&
        currentManifest.length === expectedKeys.length &&
        expectedKeys.every((key, index) => currentManifest[index]?.key === key)) {
        return { universe, generation: current, diagnostics: globalDiagnostics };
    }
    for (const specification of options.specifications) {
        options.signal?.throwIfAborted();
        const keys = observationKeys(specification);
        const canRetain = requested !== undefined &&
            !requested.has(specification.source) &&
            keys.every((key) => currentByKey.has(key));
        if (canRetain) {
            retained.push(...keys.map((key) => currentByKey.get(key)));
            continue;
        }
        const [layout, tests] = await Promise.all([
            observeSpecificationLayout(options.root, specification),
            observeSpecificationTests(options.root, specification),
        ]);
        shards.push(observationShard(provisional, APPLICATION_LAYOUT_FACT_NAMESPACE, specification, 'layout-observation', layout), observationShard(provisional, APPLICATION_TEST_FACT_NAMESPACE, specification, 'test-evidence', tests), observationShard(provisional, APPLICATION_SCHEMA_FACT_NAMESPACE, specification, 'schema-catalog', observeSpecificationSchemas(specification, schemaDiagnostics)), observationShard(provisional, APPLICATION_CONTEXT_FACT_NAMESPACE, specification, 'module-context', observeSpecificationContext(specification, inventoryIndex)));
    }
    shards.sort((left, right) => left.key.localeCompare(right.key));
    const manifest = [...retained, ...shards.map(shardReference)].sort((left, right) => left.key.localeCompare(right.key));
    const semanticGeneration = {
        universe,
        producer: OBSERVATION_PRODUCER,
        sourceManifest,
        capabilities: [
            APPLICATION_LAYOUT_FACT_NAMESPACE,
            APPLICATION_CONTEXT_FACT_NAMESPACE,
            APPLICATION_SCHEMA_FACT_NAMESPACE,
            APPLICATION_TEST_FACT_NAMESPACE,
        ].sort(),
    };
    const id = generationIdentity(semanticGeneration, manifest);
    if (current?.id === id) {
        return { universe, generation: current, diagnostics: globalDiagnostics };
    }
    const nextKeys = new Set(manifest.map((entry) => entry.key));
    const rebound = shards.map((shard) => bindGeneration(shard, id));
    const generation = {
        id,
        sequence: (current?.sequence ?? 0) + 1,
        ...semanticGeneration,
    };
    await options.store.commit({
        protocolVersion: 1,
        ...(current ? { base: current.id } : {}),
        next: generation,
        manifest,
        upserts: rebound.filter((shard) => currentByKey.get(shard.key)?.digest !== shard.digest),
        deletes: currentManifest
            .filter((entry) => !nextKeys.has(entry.key))
            .map((entry) => entry.key)
            .sort(),
    }, { signal: options.signal });
    return { universe, generation, diagnostics: globalDiagnostics };
}
function observationKeys(specification) {
    return [
        APPLICATION_LAYOUT_FACT_NAMESPACE,
        APPLICATION_TEST_FACT_NAMESPACE,
        APPLICATION_SCHEMA_FACT_NAMESPACE,
        APPLICATION_CONTEXT_FACT_NAMESPACE,
    ]
        .map((namespace) => deriveAnalysisId('fact-shard-key', namespace, {
        specification: specification.module.id,
        schemaVersion: 1,
    }))
        .sort();
}
function observeSpecificationContext(specification, inventory) {
    const specDirectory = specification.source.slice(0, -'/api.d.ts'.length);
    const historyRoot = specification.root === '.' ? '.history/' : `${specification.root}/.history/`;
    const resource = (path) => {
        const file = inventory.byPath.get(path);
        return file ? contextResource(file) : undefined;
    };
    return {
        specification: specification.id,
        ...(resource(`${specDirectory}/architecture.md`)
            ? { architecture: resource(`${specDirectory}/architecture.md`) }
            : {}),
        ...(resource(`${specDirectory}/icon.svg`)
            ? { icon: resource(`${specDirectory}/icon.svg`) }
            : {}),
        history: (inventory.historyByRoot.get(historyRoot) ?? [])
            .map(contextResource)
    };
}
function contextResource(file) {
    const extension = file.path.split('.').at(-1)?.toLowerCase() ?? '';
    const presentation = extension === 'md'
        ? 'markdown'
        : extension === 'pdf'
            ? 'pdf'
            : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)
                ? 'image'
                : ['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'txt', 'css', 'html', 'xml'].includes(extension)
                    ? 'text'
                    : 'binary';
    const mediaType = extension === 'md'
        ? 'text/markdown'
        : extension === 'pdf'
            ? 'application/pdf'
            : extension === 'svg'
                ? 'image/svg+xml'
                : extension === 'png'
                    ? 'image/png'
                    : extension === 'jpg' || extension === 'jpeg'
                        ? 'image/jpeg'
                        : extension === 'json'
                            ? 'application/json'
                            : presentation === 'text'
                                ? 'text/plain'
                                : 'application/octet-stream';
    return {
        source: file.source,
        revision: file.revision,
        path: file.path,
        bytes: file.bytes,
        mediaType,
        presentation,
    };
}
function observeSpecificationSchemas(specification, diagnostics) {
    const sources = specification.schemas.map((resource) => resource.source).sort();
    const owned = new Set(sources);
    return {
        specification: specification.id,
        sources,
        diagnostics: diagnostics.filter((diagnostic) => owned.has(diagnostic.file)),
    };
}
async function observeSpecificationLayout(root, specification) {
    const layout = specification.layout;
    if (!layout) {
        return {
            specification: specification.id,
            source: specification.source,
            declared: false,
            exact: false,
            ignore: [],
            entries: [],
            additional: [],
            diagnostics: [],
        };
    }
    const compiled = compileLayout(layout.source, layout.text);
    const observed = await observeLayout(root, resolve(root, specification.root), layout.source, compiled.entries, { exact: compiled.exact, ignore: compiled.ignore });
    return {
        specification: specification.id,
        source: specification.source,
        declared: true,
        exact: compiled.exact,
        ignore: observed.ignore,
        entries: observed.observation.entries,
        additional: observed.observation.additional,
        revision: observed.observation.revision,
        diagnostics: deduplicate([...compiled.diagnostics, ...observed.diagnostics]),
    };
}
async function observeSpecificationTests(root, specification) {
    const laws = specification.laws.map(withEmptyEvidence);
    const states = specification.states.map(withEmptyStateEvidence);
    const resolved = await resolveTestEvidence(root, resolve(root, specification.root), laws, states);
    return {
        specification: specification.id,
        laws: resolved.laws.flatMap((resource) => resource.definitions.map((definition) => ({
            id: definition.id,
            source: resource.source,
            evidence: definition.testEvidence,
        }))),
        states: resolved.states.flatMap((resource) => resource.definitions.map((definition) => ({
            id: definition.exportName,
            source: resource.source,
            evidence: definition.testEvidence,
        }))),
        diagnostics: resolved.diagnostics,
    };
}
function withEmptyEvidence(resource) {
    return {
        ...resource,
        definitions: resource.definitions.map((definition) => ({ ...definition, testEvidence: [] })),
    };
}
function withEmptyStateEvidence(resource) {
    return {
        ...resource,
        definitions: resource.definitions.map((definition) => ({ ...definition, testEvidence: [] })),
    };
}
function observationShard(generation, namespace, specification, kind, payload) {
    const schemaVersion = 1;
    const fact = {
        id: deriveAnalysisId('fact', namespace, { specification: specification.id }),
        generation,
        namespace,
        schemaVersion,
        kind,
        subject: specification.module.id,
        completeness: { kind: 'complete' },
        provenance: {
            pass: OBSERVATION_PASS,
            passVersion: '1.0.0',
            evidence: [],
            inputs: [],
        },
        payload,
    };
    const input = {
        key: deriveAnalysisId('fact-shard-key', namespace, {
            specification: specification.module.id,
            schemaVersion,
        }),
        namespace,
        schemaVersion,
        completion: { kind: 'complete' },
        facts: [fact],
    };
    return { ...input, digest: factShardDigest(input) };
}
function bindGeneration(shard, generation) {
    return { ...shard, facts: shard.facts.map((fact) => ({ ...fact, generation })) };
}
async function withManifest(store, universe, generation) {
    const query = await store.open(universe, generation);
    try {
        return await query.manifest();
    }
    finally {
        await query.dispose();
    }
}
function deduplicate(values) {
    return [
        ...new Map(values.map((value) => [
            `${value.code}\0${value.file}\0${value.line}\0${value.column}\0${value.message}`,
            value,
        ])).values(),
    ].sort((left, right) => `${left.file}\0${left.line}\0${left.column}\0${left.code}`.localeCompare(`${right.file}\0${right.line}\0${right.column}\0${right.code}`));
}
//# sourceMappingURL=materialize.js.map