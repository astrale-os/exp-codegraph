import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { sourceRevision } from '../source/file.js';
import { workspacePackageCoordinate } from '../typescript/package-coordinate.js';
import { observePublicSurface } from '../typescript/surface/observe.js';
import { DEFAULT_DECLARATION_SURFACE_SEMANTICS, } from '../typescript/surface/semantics.js';
import { canonicalSymbolIdentity, factoryFacetDeclarations, firstDeclaration, resolveAlias, semanticTokenIdentity, } from '../typescript/surface/symbol.js';
import { collectExternalReferences, isExternalSpecifier, renderExternalModules, } from './external.js';
// Keep the byte ceiling as the primary admission bound. Real hierarchical public contracts can
// legitimately cross more than 128 small declaration fragments without becoming unsafe to parse.
const MAX_API_SOURCES = 192;
const MAX_API_SOURCE_BYTES = 8 * 1024 * 1024;
export function compileDeclarationApi(options) {
    return compileDeclarationApis([options])[0];
}
/** Compile declaration entrypoints sharing a project root against one immutable TypeScript program. */
export function compileDeclarationApis(options) {
    const results = [];
    const groups = new Map();
    for (const [index, request] of options.entries()) {
        try {
            const mainFile = realpathSync(resolve(request.mainFile));
            const projectRoot = realpathSync(resolve(request.projectRoot ?? dirname(mainFile)));
            const semantics = request.semantics ?? DEFAULT_DECLARATION_SURFACE_SEMANTICS;
            if (!inside(projectRoot, mainFile)) {
                results[index] = failed('API_ENTRYPOINT_OUTSIDE_ROOT', 'API entrypoint escapes the project root.');
                continue;
            }
            if (!mainFile.endsWith('.d.ts')) {
                results[index] = failed('API_ENTRYPOINT_EXTENSION', 'API entrypoint must be an api.d.ts declaration file.');
                continue;
            }
            const group = groups.get(projectRoot) ?? [];
            group.push({ index, mainFile, projectRoot, semantics });
            groups.set(projectRoot, group);
        }
        catch (error) {
            results[index] = failed('API_COMPILE_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
    for (const [projectRoot, requests] of groups) {
        compileProjectGroup(projectRoot, requests, results);
    }
    return results;
}
function compileProjectGroup(projectRoot, requests, results) {
    const compilerOptions = declarationCompilerOptions();
    const discoveryHost = ts.createCompilerHost(compilerOptions);
    const entries = new Map();
    const valid = [];
    for (const request of requests) {
        try {
            const entry = discoverDeclarationEntry(request.mainFile, projectRoot, compilerOptions, discoveryHost);
            entries.set(request.mainFile, entry);
            valid.push(request);
        }
        catch (error) {
            results[request.index] = failed('API_COMPILE_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
    if (!valid.length)
        return;
    const partitions = partitionDeclarationEntries(valid, entries);
    for (const partition of partitions) {
        compileProjectPartition(projectRoot, partition, entries, compilerOptions, results);
    }
}
function compileProjectPartition(projectRoot, valid, entries, compilerOptions, results) {
    let project;
    try {
        project = createDeclarationProject(valid.map(({ mainFile }) => mainFile), projectRoot, new Set(valid.flatMap(({ mainFile }) => [...entries.get(mainFile).files])), valid.map(({ mainFile }) => entries.get(mainFile).externalReferences), compilerOptions);
    }
    catch (error) {
        const failure = failed('API_COMPILE_FAILED', error instanceof Error ? error.message : String(error));
        for (const request of valid)
            results[request.index] = failure;
        return;
    }
    const programDiagnostics = ts.getPreEmitDiagnostics(project.program);
    for (const request of valid) {
        try {
            results[request.index] = compilePreparedApi(request, entries.get(request.mainFile).files, project, programDiagnostics);
        }
        catch (error) {
            results[request.index] = failed('API_COMPILE_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
}
function partitionDeclarationEntries(requests, entries) {
    const compatible = new Map();
    const isolated = [];
    for (const request of requests) {
        const entry = entries.get(request.mainFile);
        if (entry.ambientEffects) {
            isolated.push([request]);
            continue;
        }
        // External package declarations are projected from each entrypoint's own syntax. Entrypoints
        // may share a Program only when those virtual modules are byte-for-byte identical; otherwise
        // one declaration could enrich a neighbor's package identity.
        const signature = externalProjectionSignature(entry.externalReferences);
        const group = compatible.get(signature) ?? [];
        group.push(request);
        compatible.set(signature, group);
    }
    return [...compatible.values(), ...isolated];
}
function externalProjectionSignature(references) {
    return JSON.stringify([...renderExternalModules([references])]);
}
function sourceHasAmbientEffects(source) {
    if (!ts.isExternalModule(source) || source.libReferenceDirectives.length > 0)
        return true;
    let ambient = false;
    const visit = (node) => {
        if (ts.isNamespaceExportDeclaration(node) ||
            (ts.isModuleDeclaration(node) &&
                ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0 || ts.isStringLiteral(node.name)))) {
            ambient = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return ambient;
}
function compilePreparedApi(request, files, project, programDiagnostics) {
    const { mainFile, projectRoot } = request;
    try {
        const dependencies = compilationDependencies(project.program, projectRoot, files);
        const authored = authoredSources(projectRoot, mainFile, files);
        const authoredSet = new Set(authored);
        const diagnostics = [
            ...declarationDiagnostics(programDiagnostics, projectRoot, authoredSet),
            ...pseudoPrivateDeclarationDiagnostics(project.program, projectRoot, authoredSet),
        ];
        if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
            return { ok: false, diagnostics, dependencies };
        }
        const ownedFiles = new Set(authored);
        const surface = observePublicSurface(projectRoot, project, mainFile, {
            explicitExportsOnly: true,
            ownedFiles,
            semantics: request.semantics,
        });
        const sources = sourceModels(project.program, projectRoot, authored);
        const metadata = declarationMetadata(project, surface.declarations.map((item) => item.identity), projectRoot, files);
        const authoredDisplayPaths = new Set(authored.map((file) => displayPath(file, projectRoot)));
        for (const declaration of surface.declarations) {
            if (declaration.location.file && !authoredDisplayPaths.has(declaration.location.file)) {
                metadata[declaration.identity] = { conformance: 'identity', errors: [] };
            }
        }
        diagnostics.push(...surface.issues
            .filter((issue) => !issue.declaration || issueConformance(metadata, issue.declaration) !== 'identity')
            .map((issue) => issueDiagnostic(issue, projectRoot)));
        if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
            return { ok: false, diagnostics, dependencies };
        }
        const tokens = semanticTokens(project, sources, projectRoot);
        const sourceDigest = hash(dependencies.map((dependency) => `${dependency.file}\0${dependency.revision}`).join('\0'));
        const entrypoint = displayPath(mainFile, projectRoot);
        const version = 2;
        const semantic = {
            format: 'astrale.api',
            version,
            entrypoint,
            sourceFiles: sources.map(({ file }) => file),
            surface: semanticSurface(surface),
            metadata: semanticMetadata(surface, metadata),
        };
        const api = {
            format: semantic.format,
            version: semantic.version,
            entrypoint,
            fingerprint: hash(stableJson(semantic)),
            sourceRevision: sourceDigest,
            dependencies,
            sources,
            surface,
            metadata,
            tokens,
        };
        return { ok: true, api, diagnostics, dependencies };
    }
    catch (error) {
        return failed('API_COMPILE_FAILED', error instanceof Error ? error.message : String(error));
    }
}
function compilationDependencies(program, root, files) {
    return [...files]
        .flatMap((file) => {
        if (!inside(root, file) || !file.endsWith('.d.ts'))
            return [];
        const source = program.getSourceFile(file);
        if (!source)
            return [];
        return [{ file: displayPath(file, root), revision: sourceRevision(source.text) }];
    })
        .sort((left, right) => compare(left.file, right.file));
}
function semanticMetadata(surface, metadata) {
    const output = {};
    for (const declaration of surface.declarations) {
        const stable = `${declaration.location.file ?? declaration.location.external}:${declaration.kind}:${declaration.name}`;
        const own = metadata[declaration.identity];
        if (own)
            output[stable] = own;
        const typeFacet = metadata[`${declaration.identity}#facet:type`];
        if (typeFacet)
            output[`${stable}#facet:type`] = typeFacet;
        const valueFacet = metadata[`${declaration.identity}#facet:value`];
        if (valueFacet)
            output[`${stable}#facet:value`] = valueFacet;
        for (const member of [
            ...(declaration.properties ?? []),
            ...(declaration.callables ?? []),
            ...(declaration.statics ?? []),
        ]) {
            const value = metadata[`${declaration.identity}#${member.name}`];
            if (value)
                output[`${stable}#${member.name}`] = value;
        }
    }
    return Object.fromEntries(Object.entries(output).sort(([left], [right]) => compare(left, right)));
}
function declarationCompilerOptions() {
    return {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        allowImportingTsExtensions: true,
        resolveJsonModule: false,
        types: [],
    };
}
function createDeclarationProject(mainFiles, projectRoot, declarationFiles, externalReferences, options) {
    const host = ts.createCompilerHost(options);
    const externalModules = createExternalModules(externalReferences, projectRoot);
    const virtualSources = new Map([...externalModules.values()].map((external) => [external.file, external.source]));
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
        const canonical = realpathSafe(file) ?? resolve(file);
        if (!declarationFiles.has(canonical) && !inside(compilerLibrary, canonical))
            return;
        return originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
    };
    host.resolveModuleNameLiterals = (literals, containingFile, redirectedReference, compilerOptions, containingSourceFile) => literals.map((literal) => {
        const external = externalModules.get(literal.text);
        if (external) {
            return {
                resolvedModule: {
                    resolvedFileName: external.file,
                    extension: ts.Extension.Dts,
                    isExternalLibraryImport: true,
                },
            };
        }
        // External package declarations are semantic identities at this boundary. Never fall
        // through into node_modules for a syntax form the projection did not recognize.
        if (isExternalSpecifier(literal.text))
            return { resolvedModule: undefined };
        const resolved = ts.resolveModuleName(literal.text, containingFile, compilerOptions, host, undefined, redirectedReference, ts.getModeForUsageLocation(containingSourceFile, literal, compilerOptions)).resolvedModule;
        if (!resolved)
            return { resolvedModule: undefined };
        const canonical = realpathSafe(resolved.resolvedFileName) ?? resolve(resolved.resolvedFileName);
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
        externalCoordinates: new Map([...externalModules.values()].map(({ file, coordinate }) => [file, coordinate])),
    };
}
function discoverDeclarationEntry(mainFile, projectRoot, options, host) {
    const externalReferences = [];
    const pending = [mainFile];
    const seen = new Set();
    let sourceBytes = 0;
    let ambientEffects = false;
    while (pending.length) {
        const file = resolve(pending.pop());
        if (seen.has(file))
            continue;
        if (seen.size >= MAX_API_SOURCES) {
            throw new Error(`API exceeds ${MAX_API_SOURCES} declaration sources.`);
        }
        seen.add(file);
        const declaredBytes = statSync(file).size;
        if (sourceBytes + declaredBytes > MAX_API_SOURCE_BYTES) {
            throw new Error(`API sources exceed ${MAX_API_SOURCE_BYTES} bytes.`);
        }
        sourceBytes += declaredBytes;
        const text = host.readFile(file);
        if (text === undefined)
            continue;
        const source = ts.createSourceFile(file, text, options.target ?? ts.ScriptTarget.ES2022, true);
        ambientEffects ||= sourceHasAmbientEffects(source);
        if (source.typeReferenceDirectives.length) {
            throw new Error('External type-reference directives are unsupported in API declarations; use an explicit type-only import.');
        }
        for (const reference of source.referencedFiles) {
            const target = realpathSafe(resolve(dirname(file), reference.fileName));
            if (!target || !permittedDeclarationPath(projectRoot, target)) {
                throw new Error(`API declaration path reference must target a .spec declaration: ${reference.fileName}`);
            }
            pending.push(target);
        }
        externalReferences.push(...collectExternalReferences(source));
        for (const statement of source.statements) {
            if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
                const specifier = statement.moduleSpecifier.text;
                if (!isExternalSpecifier(specifier)) {
                    enqueueRelativeDeclaration(specifier, file, projectRoot, options, host, pending);
                }
            }
            else if (ts.isExportDeclaration(statement) &&
                statement.moduleSpecifier &&
                ts.isStringLiteral(statement.moduleSpecifier)) {
                const specifier = statement.moduleSpecifier.text;
                if (!isExternalSpecifier(specifier)) {
                    enqueueRelativeDeclaration(specifier, file, projectRoot, options, host, pending);
                }
            }
        }
    }
    return { files: seen, externalReferences, ambientEffects };
}
function createExternalModules(references, projectRoot) {
    const directory = join(projectRoot, '.astrale-spec-externals');
    return new Map([...renderExternalModules(references)].map(([specifier, source]) => {
        const file = resolve(directory, `${hash(specifier).slice(0, 24)}.d.ts`);
        return [
            specifier,
            {
                file,
                coordinate: externalCoordinate(specifier),
                source,
            },
        ];
    }));
}
function enqueueRelativeDeclaration(specifier, containingFile, projectRoot, options, host, pending) {
    const resolved = ts.resolveModuleName(specifier, containingFile, options, host).resolvedModule;
    if (!resolved?.resolvedFileName.endsWith('.d.ts'))
        return;
    const canonical = realpathSafe(resolved.resolvedFileName);
    if (canonical && permittedDeclarationPath(projectRoot, canonical))
        pending.push(canonical);
}
function permittedDeclarationPath(projectRoot, file) {
    if (!file.endsWith('.d.ts') || file.includes(`${sep}node_modules${sep}`))
        return false;
    if (inside(projectRoot, file))
        return true;
    return Boolean(file.includes(`${sep}.spec${sep}`) && workspacePackageCoordinate(projectRoot, file));
}
function externalCoordinate(specifier) {
    return /^(?:node|bun|deno):/u.test(specifier) ? `platform:${specifier}` : `package:${specifier}`;
}
function authoredSources(root, mainFile, files) {
    const values = [...files]
        .map((file) => realpathSafe(file))
        .filter((file) => Boolean(file) &&
        inside(root, file) &&
        (file === mainFile || (file.includes(`${sep}.spec${sep}`) && file.endsWith('.d.ts'))));
    const unique = [...new Set(values)].sort(compare);
    return unique;
}
function sourceModels(program, root, files) {
    return files.map((file) => {
        const source = program.getSourceFile(file);
        const text = source?.text ?? readFileSync(file, 'utf8');
        return { file: displayPath(file, root), revision: sourceRevision(text), text };
    });
}
function declarationDiagnostics(diagnostics, root, authored) {
    return diagnostics
        .filter((diagnostic) => {
        if (!diagnostic.file)
            return true;
        const file = realpathSafe(diagnostic.file.fileName);
        return Boolean(file && authored.has(file));
    })
        .map((diagnostic) => compilerDiagnostic(diagnostic, root));
}
/**
 * Reject declarations whose leading underscore merely pretends to make them private.
 *
 * TypeScript declaration modules may legitimately retain semantic private type closure for an
 * exported signature. A leading underscore establishes no privacy, however, and makes those
 * closure declarations look like accidental API aliases. Imported types should be qualified at
 * their use site; reusable concepts should be exported under a semantic name.
 */
function pseudoPrivateDeclarationDiagnostics(program, root, authored) {
    const diagnostics = [];
    for (const file of [...authored].sort(compare)) {
        const source = program.getSourceFile(file);
        if (!source)
            continue;
        for (const statement of source.statements) {
            for (const name of topLevelApiBindingNames(statement)) {
                if (!name.text.startsWith('_'))
                    continue;
                diagnostics.push({
                    source: 'api',
                    code: 'API_PSEUDO_PRIVATE_DECLARATION',
                    severity: 'error',
                    message: `Top-level API binding ${JSON.stringify(name.text)} uses an underscore that does not create privacy. ` +
                        'Inline or qualify a private dependency, or export a deliberate semantic concept.',
                    range: rangeOf(source, name.getStart(source), name.getEnd(), root),
                });
            }
        }
    }
    return diagnostics;
}
function topLevelApiBindingNames(statement) {
    if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (!clause)
            return [];
        const names = clause.name ? [clause.name] : [];
        if (clause.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings))
                names.push(clause.namedBindings.name);
            else
                names.push(...clause.namedBindings.elements.map(({ name }) => name));
        }
        return names;
    }
    if (ts.isImportEqualsDeclaration(statement))
        return [statement.name];
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
        return ts.isNamedExports(statement.exportClause)
            ? statement.exportClause.elements.map(({ name }) => name)
            : [statement.exportClause.name];
    }
    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.flatMap(({ name }) => bindingIdentifiers(name));
    }
    if (ts.isInterfaceDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) {
        return statement.name && ts.isIdentifier(statement.name) ? [statement.name] : [];
    }
    return [];
}
function bindingIdentifiers(name) {
    if (ts.isIdentifier(name))
        return [name];
    return name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : bindingIdentifiers(element.name));
}
function declarationMetadata(project, identities, root, files) {
    const included = new Set(identities);
    const metadata = {};
    for (const source of project.program.getSourceFiles()) {
        const file = realpathSafe(source.fileName);
        if (!source.isDeclarationFile || !file || !files.has(file))
            continue;
        visit(source);
    }
    for (const identity of included) {
        const type = metadata[`${identity}#facet:type`];
        const value = metadata[`${identity}#facet:value`];
        if (!type || !value)
            continue;
        metadata[identity] = {
            ...value,
            conformance: type.conformance === 'identity' && value.conformance === 'identity' ? 'identity' : 'exact',
        };
    }
    return Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => compare(left, right)));
    function visit(node) {
        if (ts.isMethodSignature(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isPropertySignature(node)) {
            const ownerNode = node.parent;
            const ownerName = (ts.isInterfaceDeclaration(ownerNode) || ts.isClassDeclaration(ownerNode)) && ownerNode.name;
            const memberName = node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
            const ownerSymbol = ownerName ? project.checker.getSymbolAtLocation(ownerName) : undefined;
            if (ownerSymbol && memberName) {
                const ownerIdentity = canonicalSymbolIdentity(root, resolveAlias(project.checker, ownerSymbol));
                if (included.has(ownerIdentity)) {
                    const memberSymbol = project.checker.getSymbolAtLocation(node.name);
                    if (memberSymbol) {
                        metadata[`${ownerIdentity}#${memberName}`] = metadataOf(project.checker, resolveAlias(project.checker, memberSymbol), node);
                    }
                }
            }
        }
        const name = declarationName(node);
        if (name) {
            const symbol = project.checker.getSymbolAtLocation(name);
            if (symbol) {
                const target = resolveAlias(project.checker, symbol);
                const identity = canonicalSymbolIdentity(root, target);
                if (included.has(identity)) {
                    const facets = factoryFacetDeclarations(project.checker, target);
                    const facet = facets
                        ? node === facets.type
                            ? 'type'
                            : node === facets.value
                                ? 'value'
                                : undefined
                        : undefined;
                    metadata[facet ? `${identity}#facet:${facet}` : identity] = metadataOf(project.checker, target, node);
                }
            }
        }
        ts.forEachChild(node, visit);
    }
}
function issueConformance(metadata, declaration) {
    if (declaration.endsWith('#value')) {
        return (metadata[`${declaration.slice(0, -'#value'.length)}#facet:value`]?.conformance ??
            metadata[declaration.slice(0, -'#value'.length)]?.conformance);
    }
    return metadata[`${declaration}#facet:type`]?.conformance ?? metadata[declaration]?.conformance;
}
function metadataOf(checker, symbol, node) {
    const tags = ts.getJSDocTags(node);
    const values = (name) => tags
        .filter((tag) => tag.tagName.text === name)
        .map((tag) => jsDocText(tag.comment))
        .filter(Boolean);
    const declaredConformance = values('conformance');
    const conformance = declaredConformance.includes('exact')
        ? 'exact'
        : declaredConformance.includes('identity') || isShapeFreeDeclaration(node)
            ? 'identity'
            : 'exact';
    const errors = values('throws')
        .flatMap((value) => value.split(/[\s,]+/u))
        .filter(Boolean)
        .sort(compare);
    const documentation = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
    const remarks = values('remarks').join('\n\n');
    const form = declarationForm(node);
    const declaration = firstDeclaration(symbol);
    let signature;
    if (declaration) {
        try {
            const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
            signature = checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation);
        }
        catch {
            signature = undefined;
        }
    }
    return {
        conformance,
        errors,
        ...(form ? { form } : {}),
        ...(documentation ? { documentation } : {}),
        ...(remarks ? { remarks } : {}),
        ...(signature ? { signature } : {}),
    };
}
function declarationForm(node) {
    if (ts.isTypeAliasDeclaration(node))
        return 'type-alias';
    if (ts.isVariableDeclaration(node))
        return 'variable';
    if (ts.isFunctionDeclaration(node))
        return 'function';
    if (ts.isInterfaceDeclaration(node))
        return 'interface';
    if (ts.isClassDeclaration(node))
        return 'class';
    if (ts.isEnumDeclaration(node))
        return 'enum';
    if (ts.isModuleDeclaration(node))
        return 'namespace';
    if (ts.isMethodSignature(node) || ts.isMethodDeclaration(node))
        return 'method';
    if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node))
        return 'property';
    return undefined;
}
function isShapeFreeDeclaration(node) {
    if (ts.isTypeAliasDeclaration(node))
        return node.type.kind === ts.SyntaxKind.UnknownKeyword;
    if (ts.isInterfaceDeclaration(node)) {
        return node.members.length === 0 && (node.heritageClauses?.length ?? 0) === 0;
    }
    if (ts.isFunctionDeclaration(node)) {
        return node.parameters.length === 0 && node.type?.kind === ts.SyntaxKind.UnknownKeyword;
    }
    return false;
}
function semanticTokens(project, sources, root) {
    const sourceSet = new Set(sources.map((source) => source.file));
    const tokens = [];
    for (const source of project.program.getSourceFiles()) {
        const file = displayPath(source.fileName, root);
        if (!sourceSet.has(file))
            continue;
        visit(source);
        function visit(node) {
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
        }
    }
    return tokens.sort((left, right) => compare(left.file, right.file) || left.from - right.from);
}
function semanticSurface(surface) {
    const identities = new Map(surface.declarations.map((declaration) => [
        declaration.identity,
        [
            declaration.location.file ?? declaration.location.external,
            declaration.kind,
            declaration.name,
            declaration.exportPaths
                .map((path) => path.join('.'))
                .sort(compare)
                .join('|'),
        ].join(':'),
    ]));
    const normalize = (value, key) => {
        if (Array.isArray(value)) {
            const items = value.map((item) => normalize(item));
            return key === 'referencedDeclarations' ? items.sort(compareUnknown) : items;
        }
        if (!value || typeof value !== 'object')
            return value;
        const output = {};
        for (const [key, child] of Object.entries(value)) {
            if (key === 'location')
                continue;
            if ((key === 'identity' || key === 'declaration') && typeof child === 'string') {
                output[key] = identities.get(child) ?? child;
                continue;
            }
            if (key === 'referencedDeclarations' && Array.isArray(child)) {
                output[key] = child.map((identity) => identities.get(identity) ?? identity).sort(compare);
                continue;
            }
            output[key] = normalize(child, key);
        }
        return output;
    };
    const exports = surface.exports.map((item) => normalize(item)).sort(compareUnknown);
    const declarations = surface.declarations.map((item) => normalize(item)).sort(compareUnknown);
    const issues = surface.issues.map((item) => normalize(item)).sort(compareUnknown);
    return { exports, declarations, issues };
}
function compilerDiagnostic(diagnostic, root) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (!diagnostic.file || diagnostic.start === undefined) {
        return { source: 'typescript', code: `TS${diagnostic.code}`, severity: 'error', message };
    }
    const end = diagnostic.start + (diagnostic.length ?? 0);
    return {
        source: 'typescript',
        code: `TS${diagnostic.code}`,
        severity: diagnostic.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
        message,
        range: rangeOf(diagnostic.file, diagnostic.start, end, root),
    };
}
function issueDiagnostic(issue, root) {
    return {
        source: 'api',
        code: issue.code,
        severity: 'error',
        message: issue.message,
        ...(issue.location?.file
            ? {
                range: {
                    // Surface observations already expose catalog-relative coordinates. Resolving those
                    // a second time would bind them to process.cwd() instead of the analyzed project.
                    file: isAbsolute(issue.location.file)
                        ? displayPath(issue.location.file, root)
                        : portable(issue.location.file),
                    start: { line: issue.location.line, column: issue.location.column, offset: 0 },
                    end: { line: issue.location.line, column: issue.location.column, offset: 0 },
                },
            }
            : {}),
    };
}
function rangeOf(source, start, end, root) {
    const first = source.getLineAndCharacterOfPosition(start);
    const last = source.getLineAndCharacterOfPosition(end);
    return {
        file: displayPath(source.fileName, root),
        start: { line: first.line + 1, column: first.character + 1, offset: start },
        end: { line: last.line + 1, column: last.character + 1, offset: end },
    };
}
function declarationName(node) {
    if (ts.isInterfaceDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node)) {
        return node.name;
    }
    if (ts.isVariableDeclaration(node))
        return node.name;
    return undefined;
}
function jsDocText(value) {
    if (typeof value === 'string')
        return value.trim();
    return (value ?? [])
        .map((item) => item.text)
        .join('')
        .trim();
}
function failed(code, message) {
    return { ok: false, diagnostics: [{ source: 'api', code, severity: 'error', message }] };
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .sort(([left], [right]) => compare(left, right))
            .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}
function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}
function realpathSafe(file) {
    try {
        return realpathSync(resolve(file));
    }
    catch {
        return undefined;
    }
}
function inside(root, target) {
    const path = relative(root, target);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
function displayPath(file, root) {
    const path = relative(root, resolve(file));
    return inside(root, resolve(file)) ? portable(path || '.') : portable(resolve(file));
}
function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function compareUnknown(left, right) {
    return compare(stableJson(left), stableJson(right));
}
//# sourceMappingURL=project.js.map