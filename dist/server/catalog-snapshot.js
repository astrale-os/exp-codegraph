import { indexCatalogApis } from '../api/ownership.js';
import { sourceRevision } from '../source/file.js';
import { CATALOG_INDEX_FORMAT, CATALOG_SOURCE_FORMAT, CATALOG_SPEC_FORMAT, CATALOG_TRANSPORT_VERSION, catalogSpecMetrics, } from '../viewer-host/catalog.js';
import { projectMarkdownHtml } from './catalog-markdown.js';
import { catalogReferenceProjection } from './catalog-references.js';
const MAX_SEARCH_TEXT_CHARACTERS = 64 * 1_024;
/** Build the immutable browser projection of one already-coherent server Catalog. */
export function createCatalogSnapshot(catalog, adapterManifest, applicationSnapshot = `application:${'0'.repeat(64)}`, previous) {
    const sources = new Map();
    const specs = new Map();
    const entries = [];
    const apiIndex = indexCatalogApis(catalog);
    const topology = catalogTopology(catalog);
    if (previous?.topology === topology) {
        for (const [key, value] of previous.sources)
            sources.set(key, value);
    }
    const inputs = new Map(catalog.specs.map((specification) => [specification.source, specification]));
    const declarationIdentities = ownedDeclarationIdentities(apiIndex);
    const specSourceByModuleId = new Map(catalog.specs.flatMap((spec) => spec.modules.map((module) => [module.id, spec.source])));
    for (const spec of catalog.specs) {
        const retained = reusablePayload(previous, topology, spec);
        if (retained) {
            const payload = { ...retained.payload, snapshot: applicationSnapshot };
            specs.set(specPayloadKey(spec.source, retained.entry.revision), payload);
            entries.push({ ...retained.entry, snapshot: applicationSnapshot });
            continue;
        }
        const projection = catalogReferenceProjection(spec, apiIndex);
        const packed = packSpec(spec, sources, projection.documents);
        const semanticReferences = projection.semanticReferences;
        const revision = contentRevision({ spec: packed, semanticReferences });
        const payload = {
            format: CATALOG_SPEC_FORMAT,
            version: CATALOG_TRANSPORT_VERSION,
            source: spec.source,
            revision,
            snapshot: applicationSnapshot,
            spec: packed,
            ...(semanticReferences ? { semanticReferences } : {}),
        };
        specs.set(specPayloadKey(spec.source, revision), payload);
        entries.push({
            source: spec.source,
            title: spec.title,
            searchText: specSearchText(spec),
            revision,
            snapshot: applicationSnapshot,
            metrics: catalogSpecMetrics(spec),
            ...(spec.icon ? { icon: spec.icon.icon } : {}),
            ...(declarationIdentities.get(spec.source)?.length
                ? { apiDeclarationIdentities: declarationIdentities.get(spec.source) }
                : {}),
            ...catalogContractDependencies(spec, specSourceByModuleId),
        });
    }
    const generation = contentRevision({ diagnostics: catalog.diagnostics, specs: entries });
    const index = {
        format: CATALOG_INDEX_FORMAT,
        version: CATALOG_TRANSPORT_VERSION,
        generation,
        snapshot: applicationSnapshot,
        specs: entries,
        diagnostics: catalog.diagnostics,
    };
    return {
        index,
        indexModule: catalogIndexModule(index, adapterManifest),
        specs,
        sources,
        inputs,
        topology,
    };
}
function reusablePayload(previous, topology, specification) {
    if (!previous || previous.topology !== topology || previous.inputs.get(specification.source) !== specification) {
        return;
    }
    const entry = previous.index.specs.find((candidate) => candidate.source === specification.source);
    if (!entry)
        return;
    const payload = previous.specs.get(specPayloadKey(entry.source, entry.revision));
    return payload ? { entry, payload } : undefined;
}
function catalogTopology(catalog) {
    return contentRevision(catalog.specs.flatMap((specification) => specification.modules.map((module) => ({
        module: module.id,
        source: specification.source,
        exports: module.api?.model?.surface.exports.map((item) => item.declaration) ?? [],
        imports: module.contract?.imports.map((item) => item.source) ?? [],
    }))));
}
function catalogContractDependencies(spec, specSourceByModuleId) {
    const counts = new Map();
    for (const module of spec.modules) {
        for (const dependency of module.contract?.imports ?? []) {
            const target = specSourceByModuleId.get(dependency.source);
            if (!target || target === spec.source)
                continue;
            const declarations = counts.get(target);
            if (declarations)
                declarations.add(dependency.key);
            else
                counts.set(target, new Set([dependency.key]));
        }
    }
    if (!counts.size)
        return {};
    return {
        contractDependencies: [...counts]
            .map(([source, declarations]) => ({ source, declarations: declarations.size }))
            .sort((left, right) => left.source.localeCompare(right.source)),
    };
}
function specSearchText(spec) {
    return [
        spec.title,
        spec.source,
        ...spec.modules.flatMap((module) => [
            ...(module.api?.model?.surface.exports.map((item) => item.path.join('.')) ?? []),
            ...module.ports.map((port) => `${port.namespace ?? ''} ${port.port.name}`),
        ]),
        ...spec.capabilities.flatMap((resource) => resource.definitions.map((definition) => `${definition.id} ${definition.statement}`)),
        ...spec.laws.flatMap((resource) => resource.definitions.map((definition) => `${definition.id} ${definition.statement}`)),
        ...spec.benchmarks.flatMap((resource) => resource.definitions.map((definition) => `${definition.id} ${definition.statement}`)),
        ...spec.states.flatMap((resource) => resource.definitions.map((definition) => definition.exportName)),
        ...(spec.layout?.entries.map((entry) => entry.path) ?? []),
        ...spec.packages.map((resource) => `${resource.package} ${resource.purpose}`),
    ]
        .filter(Boolean)
        .join('\n')
        .slice(0, MAX_SEARCH_TEXT_CHARACTERS);
}
function ownedDeclarationIdentities(index) {
    const identities = new Map();
    for (const [identity, owner] of index.owner) {
        const current = identities.get(owner.spec.source);
        if (current)
            current.push(identity);
        else
            identities.set(owner.spec.source, [identity]);
    }
    for (const current of identities.values())
        current.sort();
    return identities;
}
export function specPayloadKey(source, revision) {
    return `${source}\0${revision}`;
}
function packSpec(spec, sourcePayloads, documentReferences) {
    const modules = spec.modules.map((module) => packModule(module, sourcePayloads));
    return packModuleSpecification(spec, modules, documentReferences);
}
function packModuleSpecification(spec, modules, documentReferences) {
    return {
        ...spec,
        modules,
        ...(spec.architecture
            ? { architecture: packMarkdownResource(spec.architecture, documentReferences) }
            : {}),
        history: spec.history.map((resource) => resource.document
            ? {
                ...resource,
                document: packMarkdownDocument(resource.document, documentReferences),
            }
            : resource),
        ...(spec.internal
            ? {
                internal: {
                    ref: spec.internal.ref,
                    source: spec.internal.source,
                    text: spec.internal.text,
                    revision: spec.internal.revision,
                },
            }
            : {}),
    };
}
function packMarkdownResource(resource, references) {
    return { ...resource, document: packMarkdownDocument(resource.document, references) };
}
function packMarkdownDocument(document, references) {
    return {
        ...document,
        html: projectMarkdownHtml(document, references.get(document) ?? []),
    };
}
function packModule(module, sourcePayloads) {
    const { api, ports, ...rest } = module;
    return {
        ...rest,
        ...(api ? { api: packDeclaration(api, sourcePayloads) } : {}),
        ports: ports.map((port) => packPort(port, sourcePayloads)),
    };
}
function packDeclaration(resource, sources) {
    const { model, ...rest } = resource;
    return {
        ...rest,
        ...(model ? { model: packModel(model, sources) } : {}),
    };
}
function packPort(resource, sources) {
    const { model, ...rest } = resource;
    return {
        ...rest,
        ...(model ? { model: packModel(model, sources) } : {}),
    };
}
function packModel(api, sourcePayloads) {
    const { sources, tokens, ...model } = api;
    const tokensByFile = tokensGroupedByFile(tokens);
    const knownFiles = new Set(sources.map((source) => source.file));
    const unknownToken = tokens.find((token) => !knownFiles.has(token.file));
    if (unknownToken) {
        throw new Error(`API token source ${JSON.stringify(unknownToken.file)} is not declared.`);
    }
    const sourceKeys = sources.map((source) => {
        const sourceTokens = tokensByFile.get(source.file) ?? [];
        return registerSource(source, sourceTokens, sourcePayloads);
    });
    return { ...model, sourceKeys };
}
function registerSource(source, tokens, payloads) {
    const key = contentRevision({ source, tokens });
    const existing = payloads.get(key);
    if (existing) {
        if (safeJson({ source: existing.source, tokens: existing.tokens }) !==
            safeJson({ source, tokens })) {
            throw new Error(`Declaration source digest collision for ${JSON.stringify(source.file)}.`);
        }
        return key;
    }
    payloads.set(key, {
        format: CATALOG_SOURCE_FORMAT,
        version: CATALOG_TRANSPORT_VERSION,
        key,
        source,
        tokens,
    });
    return key;
}
function tokensGroupedByFile(tokens) {
    const output = new Map();
    for (const token of tokens) {
        const entries = output.get(token.file);
        if (entries)
            entries.push(token);
        else
            output.set(token.file, [token]);
    }
    return output;
}
function catalogIndexModule(index, manifest) {
    return `export const index = JSON.parse(${JSON.stringify(safeJson(index))});\nexport const adapterManifest = JSON.parse(${JSON.stringify(safeJson(manifest))});\n`;
}
function contentRevision(value) {
    return sourceRevision(safeJson(value));
}
function safeJson(value) {
    return JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}
//# sourceMappingURL=catalog-snapshot.js.map