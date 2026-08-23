import { markdownSemanticMentions } from '../specification/module/markdown-reference.js';
const identifier = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
const mention = /[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*(?:\.[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*)*/gu;
const callableKinds = new Set(['callable', 'factory']);
const MAX_SEMANTIC_REFERENCES_PER_DOCUMENT = 1_024;
/** Resolve one immutable catalog generation without adding browser-side analysis work. */
export function catalogReferenceProjection(spec, index) {
    const documents = new Map();
    const candidates = referenceCandidates(spec, index);
    if (candidates.size === 0)
        return { documents };
    const laws = {};
    for (const resource of spec.laws) {
        for (const definition of resource.definitions) {
            const statement = referencesIn(definition.statement, candidates);
            const formal = definition.formal ? referencesIn(definition.formal, candidates) : [];
            if (statement.length || formal.length) {
                laws[definition.id] = {
                    ...(statement.length ? { statement } : {}),
                    ...(formal.length ? { formal } : {}),
                };
            }
        }
    }
    projectDocuments(spec, candidates, documents);
    return {
        ...(Object.keys(laws).length ? { semanticReferences: { laws } } : {}),
        documents,
    };
}
function projectDocuments(spec, candidates, output) {
    const documents = [
        ...(spec.architecture ? [spec.architecture.document] : []),
        ...spec.history.flatMap((resource) => (resource.document ? [resource.document] : [])),
    ];
    for (const document of documents) {
        const references = referencesInMarkdown(document, candidates);
        if (references.length)
            output.set(document, references);
    }
}
function referencesInMarkdown(document, candidates) {
    const references = [];
    for (const mention of markdownSemanticMentions(document)) {
        const exact = resolveCandidate(candidates, mention.label, mention.call);
        if (!exact)
            continue;
        references.push(reference(mention.from, mention.text, exact));
        if (references.length > MAX_SEMANTIC_REFERENCES_PER_DOCUMENT)
            return [];
    }
    return references;
}
function referenceCandidates(spec, index) {
    const targets = new Map();
    for (const module of spec.modules) {
        const api = module.api?.model;
        if (!api)
            continue;
        const declarations = new Map(api.surface.declarations.map((item) => [item.identity, item]));
        const visibleLabels = new Map();
        const sources = new Map(api.sources.flatMap((source) => source.text === undefined ? [] : [[source.file, source.text]]));
        for (const item of api.surface.exports) {
            const target = declarationTarget(index, item.declaration, item.kind);
            if (!target)
                continue;
            const path = item.path.join('.');
            addVisibleCandidate(targets, visibleLabels, item.declaration, path, target);
            if (item.path.length === 1) {
                addVisibleCandidate(targets, visibleLabels, item.declaration, item.name, target);
            }
        }
        for (const token of api.tokens) {
            if (!token.target || !identifier.test(token.text))
                continue;
            const declaration = declarations.get(token.target);
            if (!declaration)
                continue;
            const target = declarationTarget(index, token.target, declaration.kind);
            const source = sources.get(token.file);
            if (!target || target.spec === spec.source || !source || source[token.from - 1] === '.') {
                continue;
            }
            addVisibleCandidate(targets, visibleLabels, token.target, token.text, target);
        }
        for (const declaration of api.surface.declarations) {
            const labels = visibleLabels.get(declaration.identity);
            if (!labels)
                continue;
            const members = [
                ...(declaration.fields ?? []),
                ...(declaration.properties ?? []),
                ...(declaration.callables ?? []),
                ...(declaration.statics ?? []),
            ];
            for (const member of members) {
                if (!identifier.test(member.name))
                    continue;
                const target = declarationTarget(index, `${declaration.identity}#${member.name}`, 'member');
                if (!target)
                    continue;
                const callable = member.callable !== undefined ||
                    member.type?.kind === 'function' ||
                    (member.overloads?.length ?? 0) > 0;
                for (const label of labels) {
                    addCandidate(targets, `${label}.${member.name}`, target, callable);
                }
            }
        }
    }
    return targets;
}
function resolveCandidate(candidates, label, call) {
    const choices = candidates.get(label);
    if (!choices)
        return;
    if (call) {
        const callable = [...choices.values()].filter((choice) => choice.callable);
        return callable.length === 1 ? callable[0] : undefined;
    }
    return choices.size === 1 ? choices.values().next().value : undefined;
}
function addVisibleCandidate(candidates, visibleLabels, identity, label, target) {
    addCandidate(candidates, label, target);
    const labels = visibleLabels.get(identity) ?? new Set();
    labels.add(label);
    visibleLabels.set(identity, labels);
}
function addCandidate(candidates, label, target, callable = callableKinds.has(target.kind)) {
    if (!label || !label.split('.').every((part) => identifier.test(part)))
        return;
    const choices = candidates.get(label) ?? new Map();
    choices.set(`${target.spec}\0${target.declaration}`, { target, callable });
    candidates.set(label, choices);
}
function declarationTarget(index, identity, kind) {
    const owner = declarationOwner(index, identity);
    const source = owner?.declaration.location.file;
    if (!owner || !source)
        return;
    return {
        spec: owner.spec.source,
        source,
        declaration: identity,
        kind,
    };
}
function declarationOwner(index, identity) {
    let candidate = identity;
    while (candidate) {
        const owner = index.owner.get(candidate);
        if (owner)
            return owner;
        const parent = parentDeclarationIdentity(candidate);
        if (!parent || parent === candidate)
            return;
        candidate = parent;
    }
    return;
}
function parentDeclarationIdentity(identity) {
    const separator = identity.lastIndexOf('#');
    const first = identity.indexOf('#');
    return separator > first ? identity.slice(0, separator) : undefined;
}
function referencesIn(value, candidates) {
    const references = [];
    for (const match of value.matchAll(mention)) {
        const from = match.index;
        const text = match[0];
        if (from > 0 && value[from - 1] === '\\')
            continue;
        const exact = resolveCandidate(candidates, text, false);
        if (exact)
            references.push(reference(from, text, exact));
    }
    return references;
}
function reference(from, text, candidate) {
    return { from, to: from + text.length, text, target: candidate.target };
}
//# sourceMappingURL=catalog-references.js.map