import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import ts from 'typescript';
import { isExternalSpecifier, renderExternalModules } from './external.js';
import { declarationRealpathSafe, permittedDeclarationPath } from './source-corpus.js';
import { createReusingDeclarationCompilerHost } from './project.optimization.js';
/** Build one file-sensitive declaration checker when callers request diagnostics only. */
export function createDeclarationDiagnosticsUniverse(projectRoot, mainFiles, declarationFiles, externalReferences, options) {
    const host = createReusingDeclarationCompilerHost(options);
    const virtualSources = new Map();
    const virtualByImport = new Map();
    const externalCoordinates = new Map();
    for (const file of [...declarationFiles].sort(compare)) {
        for (const [specifier, source] of renderExternalModules([externalReferences(file)])) {
            const virtual = resolve(projectRoot, '.astrale-spec-externals', `${digest(`${file}\0${specifier}\0${source}`).slice(0, 24)}.d.ts`);
            virtualSources.set(virtual, source);
            virtualByImport.set(`${resolve(file)}\0${specifier}`, virtual);
            externalCoordinates.set(virtual, externalCoordinate(specifier));
        }
    }
    const originalFileExists = host.fileExists.bind(host);
    const originalReadFile = host.readFile.bind(host);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    const compilerLibrary = dirname(host.getDefaultLibFileName(options));
    host.fileExists = (file) => virtualSources.has(resolve(file)) || originalFileExists(file);
    host.readFile = (file) => virtualSources.get(resolve(file)) ?? originalReadFile(file);
    host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
        const virtual = virtualSources.get(resolve(file));
        if (virtual !== undefined) {
            return ts.createSourceFile(file, virtual, languageVersion, true, ts.ScriptKind.TS);
        }
        const canonical = declarationRealpathSafe(file) ?? resolve(file);
        if (!declarationFiles.has(canonical) && !inside(compilerLibrary, canonical))
            return;
        return originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
    };
    host.resolveModuleNameLiterals = (literals, containingFile, redirectedReference, compilerOptions, containingSourceFile) => literals.map((literal) => {
        const virtual = virtualByImport.get(`${resolve(containingFile)}\0${literal.text}`);
        if (virtual) {
            return {
                resolvedModule: {
                    resolvedFileName: virtual,
                    extension: ts.Extension.Dts,
                    isExternalLibraryImport: true,
                },
            };
        }
        if (declarationFiles.has(resolve(containingFile)) && isExternalSpecifier(literal.text)) {
            return { resolvedModule: undefined };
        }
        const resolved = ts.resolveModuleName(literal.text, containingFile, compilerOptions, host, undefined, redirectedReference, ts.getModeForUsageLocation(containingSourceFile, literal, compilerOptions)).resolvedModule;
        if (!resolved)
            return { resolvedModule: undefined };
        const canonical = declarationRealpathSafe(resolved.resolvedFileName) ?? resolve(resolved.resolvedFileName);
        return permittedDeclarationPath(projectRoot, canonical)
            ? { resolvedModule: resolved }
            : { resolvedModule: undefined };
    });
    host.resolveTypeReferenceDirectiveReferences = (directives) => directives.map(() => ({ resolvedTypeReferenceDirective: undefined }));
    const program = ts.createProgram({ rootNames: [...mainFiles], options, host });
    return {
        configFile: mainFiles[0],
        program,
        checker: program.getTypeChecker(),
        issues: [],
        externalCoordinates,
    };
}
/** Check only admitted declaration sources, then restore TypeScript's canonical diagnostic order. */
export function declarationDiagnosticsForFiles(program, declarationFiles) {
    const sources = program.getSourceFiles().filter((source) => {
        const file = declarationRealpathSafe(source.fileName);
        return file !== undefined && declarationFiles.has(file);
    });
    return ts.sortAndDeduplicateDiagnostics([
        ...program.getConfigFileParsingDiagnostics(),
        ...sources.flatMap((source) => program.getSyntacticDiagnostics(source)),
        ...program.getOptionsDiagnostics(),
        ...program.getGlobalDiagnostics(),
        ...sources.flatMap((source) => program.getSemanticDiagnostics(source)),
    ]);
}
function inside(root, target) {
    const normalizedRoot = resolve(root);
    const normalizedTarget = resolve(target);
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}
function externalCoordinate(specifier) {
    return /^(?:node|bun|deno):/u.test(specifier) ? `platform:${specifier}` : `package:${specifier}`;
}
function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=diagnostics-universe.optimization.js.map