import { dirname, isAbsolute, resolve } from 'node:path';
import { operationSnapshot, operationSnapshotNamespace, withOperationSnapshot, } from '../source/operation-snapshot.js';
import { DEFAULT_DECLARATION_SURFACE_SEMANTICS } from '../typescript/surface/semantics.js';
/** Add dependency-validated, bounded memoization without changing compiler semantics. */
export function createCachedApiCompiler(compiler, dependencies, options = {}) {
    // A repository catalog commonly contains several hundred public declarations and Ports. The
    // cache must hold one complete rebuild wave or deterministic traversal order will evict the
    // entries that the next wave needs just before it reaches them.
    const capacity = positiveInteger(options.capacity, 512);
    const cache = new Map();
    const sourcePool = new Map();
    const tokenPool = new Map();
    const revisionNamespace = operationSnapshotNamespace('api-compiler-revisions');
    const compilationNamespace = operationSnapshotNamespace('api-compiler-results');
    const currentRevision = (file) => {
        const revisions = operationSnapshot(revisionNamespace);
        if (!revisions)
            return dependencies.read(file).then(dependencies.revision);
        const running = revisions.get(file);
        if (running)
            return running;
        const revision = dependencies.read(file).then(dependencies.revision);
        revisions.set(file, revision);
        return revision;
    };
    return {
        withRevisionSnapshot(operation) {
            return withOperationSnapshot(operation);
        },
        async compile(request) {
            const projectRoot = resolve(request.projectRoot ?? dirname(request.mainFile));
            const semantics = request.semantics ?? DEFAULT_DECLARATION_SURFACE_SEMANTICS;
            const declarationNavigation = request.declarationNavigation !== false;
            const declarationModel = request.declarationModel !== false;
            const key = `${projectRoot}\0${semantics}\0model:${declarationModel}\0navigation:${declarationNavigation}\0${resolve(request.mainFile)}`;
            const operationCompilations = operationSnapshot(compilationNamespace);
            const operationCompilation = operationCompilations?.get(key);
            if (operationCompilation)
                return operationCompilation;
            const cached = cache.get(key);
            if (cached && (await isCurrent(cached.compilation, projectRoot, currentRevision))) {
                cache.delete(key);
                cache.set(key, cached);
                operationCompilations?.set(key, Promise.resolve(cached.compilation));
                return cached.compilation;
            }
            cache.delete(key);
            // Coalesce only within one coherent operation. A later rebuild may observe a newer source
            // revision while an earlier compilation is still running and must not inherit that result.
            const running = operationCompilations?.get(key);
            if (running)
                return running;
            const compilation = compiler.compile(request);
            operationCompilations?.set(key, compilation);
            const result = internCompilation(await compilation, projectRoot, sourcePool, tokenPool);
            if (isCacheable(result)) {
                cache.set(key, { compilation: result });
                while (cache.size > capacity)
                    cache.delete(cache.keys().next().value);
            }
            return result;
        },
    };
}
function internCompilation(compilation, projectRoot, sourcePool, tokenPool) {
    const api = compilation.api;
    if (!api)
        return compilation;
    const tokensByFile = new Map();
    for (const token of api.tokens) {
        const values = tokensByFile.get(token.file) ?? [];
        values.push(token);
        tokensByFile.set(token.file, values);
    }
    const sources = api.sources.map((source) => {
        const key = `${projectRoot}\0${resolve(projectRoot, source.file)}\0${source.revision}`;
        return remember(sourcePool, key, source, 2_048);
    });
    const tokens = sources.flatMap((source) => {
        const values = tokensByFile.get(source.file) ?? [];
        const key = `${projectRoot}\0${resolve(projectRoot, source.file)}\0${source.revision}`;
        return rememberTokens(tokenPool, key, values, 2_048);
    });
    return { ...compilation, api: { ...api, sources, tokens } };
}
function remember(values, key, value, capacity) {
    const existing = values.get(key);
    if (existing !== undefined) {
        values.delete(key);
        values.set(key, existing);
        return existing;
    }
    values.set(key, value);
    while (values.size > capacity) {
        const oldest = values.keys().next().value;
        if (oldest === undefined)
            break;
        values.delete(oldest);
    }
    return value;
}
function rememberTokens(pool, key, tokens, capacity) {
    const maxVariants = 32;
    const variants = pool.get(key) ?? [];
    const existing = variants.find((candidate) => equalTokens(candidate, tokens));
    pool.delete(key);
    pool.set(key, existing ? variants : [...variants.slice(1 - maxVariants), tokens]);
    while (pool.size > capacity) {
        const oldest = pool.keys().next().value;
        if (oldest === undefined)
            break;
        pool.delete(oldest);
    }
    return existing ?? tokens;
}
function equalTokens(left, right) {
    return (left.length === right.length &&
        left.every((token, index) => {
            const candidate = right[index];
            return (token.file === candidate.file &&
                token.from === candidate.from &&
                token.to === candidate.to &&
                token.text === candidate.text &&
                token.declaration === candidate.declaration &&
                token.target === candidate.target);
        }));
}
async function isCurrent(compilation, projectRoot, revision) {
    if (!compilation.dependencies?.length)
        return false;
    try {
        for (const dependency of compilation.dependencies) {
            const file = isAbsolute(dependency.file)
                ? dependency.file
                : resolve(projectRoot, dependency.file);
            if ((await revision(file)) !== dependency.revision)
                return false;
        }
        return true;
    }
    catch {
        // Revision read uncertainty is a cache miss; the canonical compiler remains authoritative.
        return false;
    }
}
function isCacheable(compilation) {
    if (!compilation.dependencies?.length)
        return false;
    return (compilation.ok ||
        compilation.diagnostics.every((diagnostic) => diagnostic.source === 'api' && diagnostic.code !== 'API_COMPILE_FAILED'));
}
function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
//# sourceMappingURL=cache.js.map