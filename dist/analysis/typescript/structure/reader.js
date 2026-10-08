import { combineCompleteness } from '../../facts/index.js';
import { structuralKey as key } from './owner.js';
const complete = { kind: 'complete' };
const unavailableSource = (path) => ({ kind: 'unavailable', reasons: [{ code: 'STRUCTURAL_SOURCE_UNAVAILABLE',
            message: `The loaded non-declaration source inventory does not contain ${path}.`, retryable: true }] });
/** Project and computation readers use the same selections and negative-read witnesses. */
export function createTypeScriptStructuralReader(load, scope) {
    let activeLoad = load;
    const check = (signal) => {
        if (!activeLoad)
            throw new Error('Structural reader is disposed or its computation has expired.');
        scope?.check();
        scope?.signal?.throwIfAborted();
        signal?.throwIfAborted();
    };
    const begin = async (signal) => { check(signal); const index = await activeLoad(); check(signal); return index; };
    const selected = (index, paths) => [...new Set(paths ?? index.files.keys())].sort();
    const track = (index, keys) => { check(); scope?.selection(index.revision, [key.capability, ...keys]); };
    const inventory = (index, paths, kind, evidence, extra = complete) => {
        let completeness = combineCompleteness(index.capability, extra);
        for (const path of paths) {
            const file = index.files.get(path);
            if (file)
                completeness = combineCompleteness(completeness, file.payload.completeness[kind]);
            else
                completeness = combineCompleteness(completeness, unavailableSource(path));
        }
        return { completeness, scope: { paths, declarationFiles: false, externalSources: false }, evidence: [...new Set(evidence)].sort() };
    };
    const pathKeys = (kind, paths) => paths
        ? paths.flatMap((path) => [key.path(path), key.coverage(kind, path)])
        : [key.paths, key.coverage(kind)];
    const exportsFor = (file) => {
        if (!file)
            return [];
        const symbols = new Map(file.payload.symbols.map((symbol) => [symbol.symbol, symbol]));
        return file.payload.exports.map((entry) => ({ ...symbols.get(entry.symbol), ...entry }));
    };
    const span = (file, start, end) => ({
        source: file.payload.source, revision: file.payload.revision, start, end,
    });
    const dependency = ({ file, dependency }) => ({
        path: file.payload.logicalPath, span: span(file, dependency.start, dependency.end), kind: dependency.kind, typeOnly: dependency.typeOnly,
        ...(dependency.specifier === undefined ? {} : { specifier: dependency.specifier }),
        ...(dependency.targetPath === undefined ? {} : { targetPath: dependency.targetPath }),
    });
    return {
        dispose() { activeLoad = undefined; scope = undefined; },
        async exports(options) {
            const path = options.path, index = await begin(options.signal), file = index.files.get(path);
            track(index, [key.file(path), key.path(path), key.coverage('exports', path)]);
            const extra = file ? complete : unavailableSource(path);
            return { ...inventory(index, [path], 'exports', file ? [file.id] : [], extra), exports: exportsFor(file) };
        },
        async references(options) {
            const target = structuredClone(options.target), requested = options.paths ? [...options.paths] : undefined;
            const includeDeclarations = options.includeDeclarations === true, index = await begin(options.signal), paths = selected(index, requested);
            const symbols = new Set(), evidence = new Set(), keys = pathKeys('references', requested);
            let extra = complete;
            let state = 'resolved';
            if ('path' in target) {
                const file = index.files.get(target.path);
                keys.push(key.file(target.path), key.path(target.path), key.coverage('exports', target.path));
                if (file) {
                    extra = file.payload.completeness.exports;
                    evidence.add(file.id);
                    for (const exported of file.payload.exports)
                        if (exported.name === target.name)
                            symbols.add(exported.symbol);
                    if (!symbols.size)
                        state = extra.kind === 'complete' ? 'missing' : 'unavailable';
                }
                else {
                    state = 'unavailable';
                    extra = unavailableSource(target.path);
                }
            }
            else if ('symbol' in target)
                symbols.add(target.symbol);
            else {
                keys.push(key.origin);
                for (const file of index.files.values())
                    for (const symbol of file.payload.symbols) {
                        const origin = symbol.origin;
                        if (origin && origin.package === target.origin.package && origin.file === target.origin.file
                            && JSON.stringify(origin.path) === JSON.stringify(target.origin.path))
                            symbols.add(symbol.symbol);
                    }
            }
            const references = [];
            for (const symbol of symbols) {
                const posting = index.references.get(symbol);
                keys.push(...(requested ? paths.map((path) => key.references(symbol, path)) : [key.references(symbol)]));
                for (const path of paths)
                    for (const entry of posting?.get(path) ?? []) {
                        if (!includeDeclarations && entry.reference.kind === 'declaration')
                            continue;
                        references.push({ symbol, kind: entry.reference.kind, path,
                            span: span(entry.file, entry.reference.start, entry.reference.end),
                            ...(entry.reference.binding === undefined ? {} : { binding: entry.reference.binding }) });
                        evidence.add(entry.file.id);
                    }
            }
            references.sort((a, b) => a.path.localeCompare(b.path) || a.span.start - b.span.start || a.span.end - b.span.end || a.symbol.localeCompare(b.symbol));
            track(index, keys);
            return { ...inventory(index, paths, 'references', evidence, extra), references,
                target: state === 'resolved' ? { kind: state, symbols: [...symbols].sort() } : { kind: state } };
        },
        async dependencies(options = {}) {
            const requested = options.paths ? [...options.paths] : undefined, index = await begin(options.signal), paths = selected(index, requested);
            const dependencies = [], evidence = new Set();
            for (const path of paths) {
                const file = index.files.get(path);
                if (file)
                    for (const edge of file.payload.dependencies) {
                        dependencies.push(dependency({ file, dependency: edge }));
                        evidence.add(file.id);
                    }
            }
            dependencies.sort((a, b) => a.path.localeCompare(b.path) || a.span.start - b.span.start || a.span.end - b.span.end);
            track(index, [...pathKeys('dependencies', requested), ...paths.map(key.file)]);
            return { ...inventory(index, paths, 'dependencies', evidence), dependencies };
        },
        async dependents(options) {
            const target = options.path, transitive = options.transitive === true, index = await begin(options.signal);
            const routes = new Map(), visited = new Set([target]), queue = [target];
            const evidence = new Set(), keys = [key.paths, key.coverage('dependencies')];
            for (let offset = 0; offset < queue.length; offset++) {
                const path = queue[offset];
                check(options.signal);
                keys.push(key.incoming(path));
                const entries = [...index.incoming.get(path)?.values() ?? []].flat().sort((a, b) => a.file.payload.logicalPath.localeCompare(b.file.payload.logicalPath) || a.dependency.start - b.dependency.start);
                for (const entry of entries) {
                    const owner = entry.file.payload.logicalPath;
                    if (visited.has(owner))
                        continue;
                    visited.add(owner);
                    evidence.add(entry.file.id);
                    routes.set(owner, [dependency(entry), ...routes.get(path) ?? []]);
                    if (transitive)
                        queue.push(owner);
                }
            }
            const dependents = [...routes].sort(([a], [b]) => a.localeCompare(b)).map(([path, via]) => ({ path, via }));
            track(index, keys);
            return { ...inventory(index, selected(index), 'dependencies', evidence), dependents };
        },
    };
}
