import { isAbsolute, relative, sep } from 'node:path';
/** Generated/local trees Vite can prune before they reach semantic change filtering. */
export const DEV_SERVER_WATCH_IGNORES = [
    '**/.git/**',
    '**/.next/**',
    '**/.pnpm-store/**',
    '**/.turbo/**',
    '**/.wrangler/**',
    '**/coverage/**',
    '**/dist/**',
    '**/node_modules/**',
    '**/benchmark/artifacts/**',
    '**/benchmark/evidence/**',
    '**/benchmark/runs/**',
    '**/benchmarks/artifacts/**',
    '**/benchmarks/evidence/**',
    '**/benchmarks/runs/**',
    '**/evidence/artifacts/**',
    '**/evidence/runs/**',
    '**/qualification/artifacts/**',
    '**/qualification/evidence/**',
    '**/qualification/runs/**',
];
/**
 * Conservative V2 invalidation boundary. Precise affected-pass planning belongs to analysis;
 * the watcher only rejects definitely irrelevant filesystem events.
 */
export function isWatchedSource(snapshot, root, file, event = 'change') {
    const source = workspaceSource(root, file);
    if (!source || ignoredWorkspaceOutput(source))
        return false;
    if (source === '.spec/api.d.ts' || source.endsWith('/.spec/api.d.ts'))
        return true;
    if (!snapshot)
        return false;
    if (snapshot.specifications.some((specification) => explicitSource(specification, source))) {
        return true;
    }
    if (potentialCodeSource(source))
        return true;
    if (event === 'change')
        return false;
    // Creation/deletion changes closed `.spec` inventories, history, exact layout, package intent,
    // and potentially a compiler project. Let the application decide the affected generations.
    return snapshot.specifications.some((specification) => withinModule(specification, source));
}
function explicitSource(specification, source) {
    const moduleRoot = specification.root;
    if (source === (moduleRoot === '.' ? 'package.json' : `${moduleRoot}/package.json`) ||
        source === (moduleRoot === '.' ? 'tsconfig.json' : `${moduleRoot}/tsconfig.json`) ||
        source.startsWith(moduleRoot === '.' ? '.history/' : `${moduleRoot}/.history/`) ||
        source === specification.source.replace(/api\.d\.ts$/u, 'architecture.md') ||
        source === specification.source.replace(/api\.d\.ts$/u, 'icon.svg'))
        return true;
    return specificationSources(specification).has(source);
}
function specificationSources(specification) {
    const resources = [
        ...(specification.module.api ? [specification.module.api] : []),
        ...(specification.module.code ? [specification.module.code] : []),
        ...(specification.module.internal ? [specification.module.internal] : []),
        ...specification.module.ports,
        ...specification.schemas,
        ...specification.examples,
        ...specification.capabilities,
        ...specification.flows,
        ...specification.laws,
        ...specification.states,
        ...(specification.limits ? [specification.limits] : []),
        ...(specification.layout ? [specification.layout] : []),
        ...specification.benchmarks,
        ...specification.packages,
        ...specification.packagePatterns,
    ];
    return new Set(resources.flatMap((resource) => [
        resource.source,
        ...('model' in resource && resource.model
            ? resource.model.sources.map((candidate) => candidate.file)
            : []),
    ]));
}
function withinModule(specification, source) {
    return specification.root === '.' || source === specification.root || source.startsWith(`${specification.root}/`);
}
function potentialCodeSource(source) {
    return /\.(?:cts|mts|tsx?|cjs|mjs|jsx?)$/u.test(source);
}
function ignoredWorkspaceOutput(source) {
    const segments = normalize(source).split('/');
    if (segments.some((segment) => ['.git', '.next', '.pnpm-store', '.turbo', '.wrangler', 'coverage', 'dist', 'node_modules'].includes(segment)))
        return true;
    for (let index = 0; index < segments.length - 1; index++) {
        const parent = segments[index];
        const child = segments[index + 1];
        if (((parent === 'benchmark' || parent === 'benchmarks' || parent === 'qualification') &&
            (child === 'artifacts' || child === 'evidence' || child === 'runs')) ||
            (parent === 'evidence' && (child === 'artifacts' || child === 'runs')))
            return true;
    }
    const name = segments.at(-1) ?? '';
    return (name.endsWith('.log') ||
        name.endsWith('.tsbuildinfo') ||
        name.endsWith('.cache') ||
        name.endsWith('.local') ||
        name.endsWith('.swp') ||
        name.endsWith('.swo'));
}
function workspaceSource(root, file) {
    const path = relative(root, file);
    if (isAbsolute(path) ||
        path === '..' ||
        path.startsWith(`..${sep}`) ||
        path.startsWith('../') ||
        path.startsWith('..\\'))
        return;
    return normalize(path);
}
function normalize(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
//# sourceMappingURL=watch.js.map