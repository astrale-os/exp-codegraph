import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { readBounded } from '../../source/file.js';
import { locateDescriptorValue } from './descriptor.js';
/** Resolve authored code anchors to files and declarations without importing or executing code. */
export async function resolveCodeAnchors(root, moduleRoot, laws) {
    if (!laws.some((resource) => resource.definitions.some((definition) => definition.code?.length))) {
        return [];
    }
    const diagnostics = [];
    const rootReal = await realpath(root);
    const cache = new Map();
    for (const resource of laws) {
        for (const definition of resource.definitions) {
            for (const anchor of definition.code ?? []) {
                try {
                    await resolveAnchor(anchor, root, rootReal, moduleRoot, cache);
                }
                catch (error) {
                    const failure = asAnchorFailure(error);
                    diagnostics.push({
                        code: failure.code,
                        message: `${failure.message} (${anchor.file}${anchor.symbol ? `#${anchor.symbol}` : ''})`,
                        file: resource.source,
                        ...locateDescriptorValue(resource.source, resource.text, definition.exportName, [
                            'code',
                            { element: { file: anchor.file, symbol: anchor.symbol } },
                        ]),
                    });
                }
            }
        }
    }
    return diagnostics;
}
async function resolveAnchor(anchor, root, rootReal, moduleRoot, cache) {
    if (isAbsolute(anchor.file)) {
        throw anchorFailure('CODE_ANCHOR_PATH_INVALID', 'Code anchor paths must be relative to the module root.');
    }
    const absolute = resolve(moduleRoot, anchor.file);
    if (!within(root, absolute)) {
        throw anchorFailure('CODE_ANCHOR_PATH_INVALID', 'A code anchor must remain within the specification catalog root.');
    }
    const actual = await realpath(absolute).catch((error) => {
        throw anchorFailure('CODE_ANCHOR_FILE_INVALID', `Code anchor file cannot be read (${fileErrorCode(error)}).`);
    });
    if (!within(rootReal, actual)) {
        throw anchorFailure('CODE_ANCHOR_PATH_INVALID', 'A code anchor resolves outside the specification catalog root.');
    }
    if (!(await stat(actual)).isFile()) {
        throw anchorFailure('CODE_ANCHOR_FILE_INVALID', 'A code anchor must name a file.');
    }
    if (!anchor.symbol)
        return;
    if (!/\.[cm]?[jt]sx?$/iu.test(actual)) {
        throw anchorFailure('CODE_ANCHOR_SYMBOL_UNSUPPORTED', 'A code anchor symbol requires a JavaScript or TypeScript file.');
    }
    let parsed = cache.get(actual);
    if (!parsed) {
        parsed = parseAnchoredFile(actual, portable(relative(root, absolute)));
        cache.set(actual, parsed);
    }
    const file = await parsed;
    const [name, member] = anchor.symbol.split('.');
    const declarations = topLevelDeclarations(file, name);
    if (!declarations.length) {
        throw anchorFailure('CODE_ANCHOR_SYMBOL_MISSING', `No top-level declaration is named ${JSON.stringify(name)}.`);
    }
    if (member === undefined)
        return;
    const classes = declarations.flatMap(classOf);
    if (!classes.some((declaration) => classMemberNames(declaration).has(member))) {
        throw anchorFailure('CODE_ANCHOR_SYMBOL_MISSING', classes.length
            ? `Class ${JSON.stringify(name)} declares no member ${JSON.stringify(member)}.`
            : `Top-level declaration ${JSON.stringify(name)} is not a class.`);
    }
}
async function parseAnchoredFile(absolute, source) {
    let text;
    try {
        text = await readBounded(absolute);
    }
    catch (error) {
        throw anchorFailure('CODE_ANCHOR_FILE_INVALID', `Code anchor file cannot be read (${fileErrorCode(error)}).`);
    }
    const file = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, scriptKind(source));
    const parseDiagnostics = file.parseDiagnostics;
    if (parseDiagnostics?.length) {
        throw anchorFailure('CODE_ANCHOR_FILE_INVALID', `Code anchor file has invalid syntax: ${ts.flattenDiagnosticMessageText(parseDiagnostics[0].messageText, '\n')}`);
    }
    return file;
}
function topLevelDeclarations(file, name) {
    const declarations = [];
    for (const statement of file.statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (bindingNames(declaration.name).includes(name))
                    declarations.push(declaration);
            }
        }
        else if ((ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isEnumDeclaration(statement) ||
            ts.isModuleDeclaration(statement)) &&
            statement.name &&
            ts.isIdentifier(statement.name) &&
            statement.name.text === name) {
            declarations.push(statement);
        }
    }
    return declarations;
}
function bindingNames(name) {
    if (ts.isIdentifier(name))
        return [name.text];
    return name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
}
function classOf(declaration) {
    if (ts.isClassDeclaration(declaration))
        return [declaration];
    if (ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isClassExpression(declaration.initializer)) {
        return [declaration.initializer];
    }
    return [];
}
function classMemberNames(declaration) {
    const names = new Set();
    for (const member of declaration.members) {
        if (ts.isConstructorDeclaration(member)) {
            names.add('constructor');
            for (const parameter of member.parameters) {
                // A parameter property declares a member of the class it constructs.
                if (parameter.modifiers?.length && ts.isIdentifier(parameter.name)) {
                    names.add(parameter.name.text);
                }
            }
        }
        else if (member.name &&
            (ts.isIdentifier(member.name) ||
                ts.isPrivateIdentifier(member.name) ||
                ts.isStringLiteral(member.name))) {
            names.add(member.name.text);
        }
    }
    return names;
}
function scriptKind(source) {
    if (/\.tsx$/i.test(source))
        return ts.ScriptKind.TSX;
    if (/\.jsx$/i.test(source))
        return ts.ScriptKind.JSX;
    if (/\.[cm]?js$/i.test(source))
        return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
}
function fileErrorCode(error) {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
        return error.code;
    }
    return error instanceof Error ? error.name : 'unknown';
}
function within(parent, child) {
    const path = relative(parent, child);
    return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
function portable(value) {
    return value.split(sep).join('/');
}
function anchorFailure(code, message) {
    return { code, message };
}
function asAnchorFailure(error) {
    if (error &&
        typeof error === 'object' &&
        'code' in error &&
        'message' in error &&
        typeof error.code === 'string' &&
        typeof error.message === 'string' &&
        error.code.startsWith('CODE_ANCHOR_')) {
        return error;
    }
    return {
        code: 'CODE_ANCHOR_FILE_INVALID',
        message: error instanceof Error ? error.message : String(error),
    };
}
