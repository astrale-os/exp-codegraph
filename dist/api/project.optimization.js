import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { sourceRevision } from '../source/file.js';
import { operationSourceText } from '../source/operation-snapshot.js';
import { resolveAlias, semanticTokenIdentity } from '../typescript/surface/symbol.js';
const tokensByChecker = new WeakMap();
const canonicalPathsByProgram = new WeakMap();
const dependenciesByProgram = new WeakMap();
const diagnosticsBySource = new WeakMap();
/** Reuse each exact declaration AST between corpus discovery and its compiler universe. */
export function createReusingDeclarationCompilerHost(options) {
    const host = ts.createCompilerHost(options);
    const originalReadFile = host.readFile.bind(host);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    const sources = new Map();
    host.readFile = (file) => operationSourceText(file)?.text ?? originalReadFile(file);
    host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
        const key = resolve(file);
        if (!shouldCreateNewSourceFile) {
            const current = sources.get(key);
            if (current)
                return current;
        }
        const admitted = operationSourceText(file);
        const parsed = admitted
            ? ts.createSourceFile(file, admitted.text, languageVersion, true, ts.ScriptKind.TS)
            : originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
        if (parsed && !shouldCreateNewSourceFile)
            sources.set(key, parsed);
        return parsed;
    };
    return host;
}
/** Canonicalize each declaration Program path once across overlapping owner closures. */
export function declarationProgramRealpathOnce(program, file) {
    let values = canonicalPathsByProgram.get(program);
    if (!values) {
        values = new Map();
        canonicalPathsByProgram.set(program, values);
    }
    if (values.has(file))
        return values.get(file);
    let canonical;
    try {
        canonical = realpathSync(resolve(file));
    }
    catch {
        canonical = undefined;
    }
    values.set(file, canonical);
    return canonical;
}
/** Hash one immutable declaration source once across overlapping owner dependency projections. */
export function declarationDependencyOnce(program, root, file) {
    let values = dependenciesByProgram.get(program);
    if (!values) {
        values = new Map();
        dependenciesByProgram.set(program, values);
    }
    const key = `${root}\0${file}`;
    if (values.has(key))
        return values.get(key);
    const path = relative(root, file);
    const inside = path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
    const source = inside && file.endsWith('.d.ts') ? program.getSourceFile(file) : undefined;
    const dependency = source
        ? { file: declarationDisplayPath(file, root), revision: sourceRevision(source.text) }
        : undefined;
    values.set(key, dependency);
    return dependency;
}
/** Reuse exact source-local diagnostics across overlapping owner closures. */
export function declarationSourceDiagnosticsOnce(source, root, collect) {
    let values = diagnosticsBySource.get(source);
    if (!values) {
        values = new Map();
        diagnosticsBySource.set(source, values);
    }
    const existing = values.get(root);
    if (existing)
        return existing;
    const diagnostics = collect();
    values.set(root, diagnostics);
    return diagnostics;
}
/** Traverse each immutable Program source once and structurally share its semantic tokens. */
export function semanticTokensOnce(project, sources, root) {
    let cache = tokensByChecker.get(project.checker);
    if (!cache) {
        cache = new Map();
        tokensByChecker.set(project.checker, cache);
    }
    const sourceSet = new Set(sources.map((source) => source.file));
    return project.program
        .getSourceFiles()
        .flatMap((source) => {
        const file = declarationDisplayPath(source.fileName, root);
        if (!sourceSet.has(file))
            return [];
        const existing = cache.get(file);
        if (existing)
            return existing;
        const tokens = [];
        const visit = (node) => {
            if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
                const symbol = project.checker.getSymbolAtLocation(node);
                if (symbol) {
                    const target = resolveAlias(project.checker, symbol);
                    const identity = semanticTokenIdentity(project.checker, target, root);
                    const declaration = target.declarations?.some((item) => item === node.parent)
                        ? identity
                        : undefined;
                    tokens.push({
                        file,
                        from: node.getStart(source),
                        to: node.getEnd(),
                        text: node.getText(source),
                        ...(declaration ? { declaration } : { target: identity }),
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        cache.set(file, tokens);
        return tokens;
    })
        .sort((left, right) => compareDeclarationText(left.file, right.file) || left.from - right.from);
}
export function declarationDisplayPath(file, root) {
    const absolute = resolve(file);
    const path = relative(root, absolute);
    const inside = path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
    return declarationPortablePath(inside ? path || '.' : absolute);
}
export function declarationPortablePath(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
export function compareDeclarationText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=project.optimization.js.map