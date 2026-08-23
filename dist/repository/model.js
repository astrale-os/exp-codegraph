import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { opendir, readFile, stat } from 'node:fs/promises';
import { extname, join, matchesGlob as nodeMatchesGlob } from 'node:path';
import { factShardDigest } from '../analysis/facts/index.js';
import { deriveAnalysisId, portablePath } from '../analysis/identity/index.js';
import { simpleDirectoryExclusion, simpleRepositoryPathMatch, } from './directory-scope.optimization.js';
export async function inventoryRepository(options) {
    const scanner = options.scanner ?? createNodeRepositoryScanner();
    const classifiers = [...(options.classifiers ?? defaultRepositoryClassifiers())].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    const files = [];
    const scanOptions = {
        signal: options.signal,
        scope: options.scope,
    };
    const accept = (entry) => {
        options.signal?.throwIfAborted();
        const path = portablePath(entry.path);
        if (!pathIncluded(path, options.scope))
            return;
        const classification = classify(entry, classifiers);
        if (!classificationIncluded(classification, options.scope))
            return;
        const source = deriveAnalysisId('source', `repository:${options.repository}`, { path });
        files.push({
            source,
            revision: deriveAnalysisId('source-revision', `${source}`, {
                digest: entry.digest,
                encoding: 'bytes',
            }),
            path,
            content: entry.content,
            language: language(path, entry.content),
            bytes: entry.bytes,
            ...ownership(path),
            classification,
        });
    };
    if (scanner.scanAll) {
        for (const entry of await scanner.scanAll(options.root, scanOptions))
            accept(entry);
    }
    else {
        for await (const entry of scanner.scan(options.root, scanOptions))
            accept(entry);
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    return {
        repository: options.repository,
        revision: deriveAnalysisId('source-manifest', `repository:${options.repository}`, {
            files: files.map((file) => [
                file.path,
                file.revision,
                file.bytes,
                file.content,
                file.classification,
                file.package,
                file.area,
            ]),
        }),
        files,
        completeness: { kind: 'complete' },
    };
}
export function repositoryFacts(inventory, context) {
    const namespace = 'astrale.repository.file';
    const schemaVersion = 1;
    const facts = inventory.files
        .map((file) => ({
        id: deriveAnalysisId('fact', namespace, {
            generation: context.generation,
            source: file.source,
            revision: file.revision,
        }),
        generation: context.generation,
        namespace,
        schemaVersion,
        kind: 'repository-file',
        subject: file.source,
        completeness: inventory.completeness,
        provenance: {
            pass: context.pass,
            passVersion: context.passVersion,
            evidence: [],
            inputs: [],
        },
        payload: file,
    }))
        .sort((left, right) => left.id.localeCompare(right.id));
    const key = deriveAnalysisId('fact-shard-key', namespace, {
        repository: inventory.repository,
        schemaVersion,
    });
    const input = {
        key,
        namespace,
        schemaVersion,
        completion: inventory.completeness,
        facts,
    };
    return [{ ...input, digest: factShardDigest(input) }];
}
export function createNodeRepositoryScanner() {
    return {
        async *scan(root, options = {}) {
            yield* scanDirectory(root, '', options.signal, options.scope?.exclude ?? []);
        },
    };
}
export function defaultRepositoryClassifiers() {
    return [purposeClassifier, provenanceClassifier, lifecycleClassifier, deliveryClassifier];
}
const purposeClassifier = {
    id: 'astrale.repository.purpose.v1',
    priority: 100,
    classify(entry) {
        const path = entry.path.toLowerCase();
        const base = path.split('/').at(-1);
        let purpose = 'unknown';
        if (path.includes('/.spec/') || path.startsWith('.spec/'))
            purpose = 'specification';
        else if (/(^|\/)(?:fixtures?|testdata)(\/|$)/u.test(path))
            purpose = 'fixture';
        else if (/(^|\/)(?:__tests__|tests?)(\/|$)/u.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(base)) {
            purpose = 'test';
        }
        else if (/(^|\/)(?:test-support|testing)(\/|$)/u.test(path))
            purpose = 'test-support';
        else if (/(^|\/)(?:evidence|qualification|benchmarks?)(\/|$)/u.test(path))
            purpose = 'evidence';
        else if (isCode(path))
            purpose = 'implementation';
        return { purpose, evidence: [`classifier:${this.id}:${purpose}`] };
    },
};
const provenanceClassifier = {
    id: 'astrale.repository.provenance.v1',
    priority: 90,
    classify(entry) {
        const path = entry.path.toLowerCase();
        const provenance = /(^|\/)(?:node_modules|vendor|third_party)(\/|$)/u.test(path)
            ? 'vendored'
            : /(^|\/)(?:dist|build|coverage|generated|\.cache)(\/|$)/u.test(path) ||
                /\.(?:generated|gen)\.[cm]?[jt]sx?$/u.test(path)
                ? 'generated'
                : 'authored';
        return { provenance, evidence: [`classifier:${this.id}:${provenance}`] };
    },
};
const lifecycleClassifier = {
    id: 'astrale.repository.lifecycle.v1',
    priority: 80,
    classify(entry) {
        const path = entry.path.toLowerCase();
        const lifecycle = /(^|\/)(?:\.history|history|archive)(\/|$)/u.test(path)
            ? 'historical'
            : /(^|\/)(?:deprecated|legacy)(\/|$)/u.test(path)
                ? 'deprecated'
                : 'active';
        return { lifecycle, evidence: [`classifier:${this.id}:${lifecycle}`] };
    },
};
const deliveryClassifier = {
    id: 'astrale.repository.delivery.v1',
    priority: 70,
    classify(entry) {
        const path = entry.path.toLowerCase();
        const delivery = /(^|\/)(?:docs?|website)(\/|$)/u.test(path) || /\.mdx?$/u.test(path)
            ? 'documentation'
            : /(^|\/)(?:scripts?|build|dist)(\/|$)/u.test(path)
                ? 'build'
                : /(^|\/)(?:__tests__|tests?|fixtures?|dev|\.github)(\/|$)/u.test(path)
                    ? 'development'
                    : isCode(path)
                        ? 'runtime'
                        : 'unknown';
        return { delivery, evidence: [`classifier:${this.id}:${delivery}`] };
    },
};
async function* scanDirectory(root, relative, signal, exclude = []) {
    signal?.throwIfAborted();
    const directory = await opendir(relative ? join(root, relative) : root);
    const entries = [];
    for await (const entry of directory)
        entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        signal?.throwIfAborted();
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (path === '.git' || path.startsWith('.git/'))
            continue;
        if (entry.isDirectory()) {
            if (repositoryDirectoryExcluded(path, exclude))
                continue;
            yield* scanDirectory(root, path, signal, exclude);
        }
        else if (entry.isFile()) {
            const absolute = join(root, ...path.split('/'));
            const [bytes, metadata] = await Promise.all([readFile(absolute), stat(absolute)]);
            yield {
                path,
                bytes: metadata.size,
                digest: createHash('sha256').update(bytes).digest('hex'),
                content: isUtf8(bytes) ? 'text' : 'binary',
            };
        }
    }
}
export function repositoryDirectoryExcluded(path, patterns) {
    return patterns.some((pattern) => {
        const normalized = portablePath(pattern);
        const simple = simpleDirectoryExclusion(path, normalized);
        return simple ?? (nodeMatchesGlob(path, normalized) ||
            nodeMatchesGlob(`${path}/__entry__`, normalized));
    });
}
function classify(entry, classifiers) {
    const result = {
        purpose: 'unknown',
        provenance: 'unknown',
        lifecycle: 'unknown',
        delivery: 'unknown',
        evidence: [],
    };
    for (const classifier of classifiers) {
        const candidate = classifier.classify(entry);
        if (!candidate)
            continue;
        if (result.purpose === 'unknown' && candidate.purpose)
            result.purpose = candidate.purpose;
        if (result.provenance === 'unknown' && candidate.provenance)
            result.provenance = candidate.provenance;
        if (result.lifecycle === 'unknown' && candidate.lifecycle)
            result.lifecycle = candidate.lifecycle;
        if (result.delivery === 'unknown' && candidate.delivery)
            result.delivery = candidate.delivery;
        if (candidate.evidence)
            result.evidence.push(...candidate.evidence);
    }
    result.evidence = [...new Set(result.evidence)].sort();
    return result;
}
function pathIncluded(path, scope) {
    if (!scope)
        return true;
    if (scope.include?.length && !scope.include.some((pattern) => matchesGlob(path, pattern)))
        return false;
    if (scope.exclude?.some((pattern) => matchesGlob(path, pattern)))
        return false;
    return true;
}
function classificationIncluded(value, scope) {
    if (!scope)
        return true;
    return ((!scope.purposes || scope.purposes.includes(value.purpose)) &&
        (!scope.provenance || scope.provenance.includes(value.provenance)) &&
        (!scope.lifecycle || scope.lifecycle.includes(value.lifecycle)) &&
        (!scope.delivery || scope.delivery.includes(value.delivery)));
}
function matchesGlob(path, pattern) {
    const normalized = portablePath(pattern);
    return simpleRepositoryPathMatch(path, normalized) ?? nodeMatchesGlob(path, normalized);
}
function language(path, content) {
    const extension = extname(path).toLowerCase();
    if (content === 'binary') {
        return {
            '.png': 'image',
            '.jpg': 'image',
            '.jpeg': 'image',
            '.gif': 'image',
            '.webp': 'image',
            '.ico': 'image',
            '.pdf': 'document',
            '.zip': 'archive',
            '.gz': 'archive',
            '.tgz': 'archive',
            '.tar': 'archive',
            '.woff': 'font',
            '.woff2': 'font',
            '.ttf': 'font',
            '.otf': 'font',
        }[extension] ?? 'binary';
    }
    return {
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.mts': 'typescript',
        '.cts': 'typescript',
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.mjs': 'javascript',
        '.cjs': 'javascript',
        '.go': 'go',
        '.rs': 'rust',
        '.py': 'python',
        '.json': 'json',
        '.md': 'markdown',
        '.mdx': 'markdown',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.sql': 'sql',
        '.svg': 'svg',
    }[extension] ?? 'unknown';
}
function ownership(path) {
    const segments = path.split('/');
    const packageName = segments[0] === 'packages'
        ? segments[1]?.startsWith('@') && segments[2]
            ? `${segments[1]}/${segments[2]}`
            : segments[1]
        : undefined;
    return {
        ...(packageName ? { package: packageName } : {}),
        ...(segments.length > 1 && segments[0] ? { area: segments[0] } : {}),
    };
}
function isCode(path) {
    return /\.(?:[cm]?[jt]sx?|go|rs|py|java|kt|swift|rb|php|cs|c|cc|cpp|h|hpp)$/u.test(path);
}
//# sourceMappingURL=model.js.map