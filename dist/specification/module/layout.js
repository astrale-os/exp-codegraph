import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { sourceRevision } from '../../source/file.js';
import { AUTHORING_SPECIFIER, authoredSourceFile, authoringHelperBinding, isAuthoringSpecifier, literalProperty, nodeDiagnostic, plainStringLiteral as stringLiteral, syntaxDiagnostics, } from './authoring-syntax.js';
export const DEFAULT_LAYOUT_IGNORE_PATTERNS = [
    '**/.check-workspace.cjs',
    '**/__tests__/**',
    '**/tests/**',
    '**/*.test.*',
    '**/*.spec.*',
];
/** Extract one closed literal path list without executing it. */
export function compileLayout(source, text) {
    const file = authoredSourceFile(source, text);
    const diagnostics = syntaxDiagnostics(source, text);
    const helper = authoringHelperBinding(file, 'defineLayout');
    const assignments = [];
    for (const statement of file.statements) {
        if (ts.isImportDeclaration(statement)) {
            if (!ts.isStringLiteral(statement.moduleSpecifier) ||
                !isAuthoringSpecifier(statement.moduleSpecifier.text)) {
                diagnostics.push(nodeDiagnostic('LAYOUT_IMPORT_INVALID', `Layout files may import only defineLayout from ${AUTHORING_SPECIFIER}.`, source, file, statement));
                continue;
            }
            const bindings = statement.importClause?.namedBindings;
            if (!bindings || !ts.isNamedImports(bindings)) {
                diagnostics.push(nodeDiagnostic('LAYOUT_IMPORT_INVALID', 'Layout files must use a named defineLayout import.', source, file, statement));
                continue;
            }
            for (const binding of bindings.elements) {
                if ((binding.propertyName?.text ?? binding.name.text) !== 'defineLayout') {
                    diagnostics.push(nodeDiagnostic('LAYOUT_IMPORT_INVALID', 'Layout files may import only defineLayout.', source, file, binding));
                }
            }
            continue;
        }
        if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
            assignments.push(statement);
            continue;
        }
        diagnostics.push(nodeDiagnostic('LAYOUT_STATEMENT_INVALID', 'Layout files may contain only an authoring import and one default export.', source, file, statement));
    }
    if (assignments.length !== 1) {
        diagnostics.push({
            code: assignments.length ? 'LAYOUT_EXPORT_AMBIGUOUS' : 'LAYOUT_DEFINITION_MISSING',
            message: 'layout.ts must default-export exactly one defineLayout literal.',
            file: source,
            line: 1,
            column: 1,
        });
    }
    const assignment = assignments[0];
    const literal = assignment ? layoutLiteral(assignment.expression, helper) : undefined;
    if (!literal) {
        if (assignment) {
            diagnostics.push(nodeDiagnostic('LAYOUT_DEFINITION_INVALID', 'The default export must call defineLayout with one array or configuration literal.', source, file, assignment));
        }
        return { entries: [], exact: false, ignore: [], diagnostics };
    }
    const configuration = ts.isObjectLiteralExpression(literal)
        ? layoutConfiguration(source, file, literal, diagnostics)
        : undefined;
    const entriesArray = ts.isArrayLiteralExpression(literal) ? literal : configuration?.entries;
    const exact = configuration?.exact ?? false;
    const ignore = configuration?.ignore ?? [];
    if (!entriesArray)
        return { entries: [], exact, ignore, diagnostics };
    if (entriesArray.elements.length === 0) {
        diagnostics.push(nodeDiagnostic('LAYOUT_EMPTY', 'Remove layout.ts when no physical ownership boundary is specified.', source, file, entriesArray));
    }
    const entries = [];
    const paths = new Map();
    for (const element of entriesArray.elements) {
        const path = stringLiteral(element);
        if (path === undefined) {
            diagnostics.push(nodeDiagnostic('LAYOUT_ENTRY_INVALID', 'Every layout entry must be a string path literal.', source, file, element));
            continue;
        }
        if (path === './') {
            diagnostics.push(nodeDiagnostic('LAYOUT_ROOT_IMPLICIT', 'The module root is implicit; remove the ./ layout entry.', source, file, element));
            continue;
        }
        const kind = layoutPathKind(path);
        if (!kind) {
            diagnostics.push(nodeDiagnostic('LAYOUT_PATH_INVALID', 'Layout paths must be canonical, relative POSIX paths; directories end with one slash.', source, file, element));
            continue;
        }
        if (selfSpecifyingPath(path)) {
            diagnostics.push(nodeDiagnostic('LAYOUT_PATH_RESERVED', 'layout.ts cannot govern .spec/ or .history/.', source, file, element));
            continue;
        }
        const position = file.getLineAndCharacterOfPosition(element.getStart(file));
        const entry = {
            path,
            kind,
            line: position.line + 1,
            column: position.character + 1,
        };
        const duplicate = paths.get(path);
        if (duplicate) {
            diagnostics.push(nodeDiagnostic('LAYOUT_PATH_DUPLICATE', `Layout path ${path} is already declared.`, source, file, element));
            continue;
        }
        paths.set(path, entry);
        entries.push(entry);
    }
    const stems = new Map();
    for (const entry of entries) {
        const stem = pathStem(entry.path);
        const conflict = stems.get(stem);
        if (conflict) {
            diagnostics.push({
                code: 'LAYOUT_PATH_KIND_CONFLICT',
                message: `Layout path ${stem} is declared as both a file and a directory.`,
                file: source,
                line: entry.line,
                column: entry.column,
            });
        }
        else {
            stems.set(stem, entry);
        }
    }
    for (const entry of entries) {
        for (const parent of parentDirectories(entry.path)) {
            const declaration = paths.get(parent);
            if (declaration?.kind === 'directory')
                continue;
            diagnostics.push({
                code: 'LAYOUT_PARENT_UNDECLARED',
                message: `Layout path ${entry.path} requires an explicit ${parent} directory entry.`,
                file: source,
                line: entry.line,
                column: entry.column,
            });
            break;
        }
    }
    return { entries, exact, ignore, diagnostics };
}
/** Compare sparse declared roots or one exact module root without following links. */
export async function observeLayout(catalogRoot, moduleRoot, source, entries, options = {}) {
    const root = resolve(catalogRoot);
    const module = resolve(moduleRoot);
    const actual = new Map();
    const observationDiagnostics = [];
    const ignore = effectiveIgnorePatterns(options.ignore ?? []);
    const scanPolicy = {
        declared: new Set(entries.map((entry) => pathStem(entry.path))),
        requiredDirectories: new Set(entries.flatMap((entry) => parentDirectories(entry.path).map(pathStem))),
        ignored: ignore.map(({ pattern }) => globExpression(pattern)),
    };
    if (options.exact) {
        await scanPhysicalPath(root, module, '.', actual, observationDiagnostics, scanPolicy);
        actual.delete('./');
    }
    else {
        const roots = entries.filter((entry) => parentDirectories(entry.path).length === 0);
        for (const entry of roots) {
            await scanPhysicalPath(root, module, pathStem(entry.path), actual, observationDiagnostics, scanPolicy);
        }
    }
    const actualByStem = new Map([...actual].map(([path, kind]) => [pathStem(path), { path, kind }]));
    const declaredByStem = new Map(entries.map((entry) => [pathStem(entry.path), entry]));
    const observedEntries = entries.map((entry) => {
        const found = actualByStem.get(pathStem(entry.path));
        return {
            path: entry.path,
            status: !found
                ? 'missing'
                : found.kind === entry.kind
                    ? 'matched'
                    : 'mismatch',
            ...(found ? { observedKind: found.kind } : {}),
        };
    });
    const observedByPath = new Map(observedEntries.map((entry) => [entry.path, entry]));
    const diagnostics = [...observationDiagnostics];
    for (const entry of entries) {
        const observation = observedByPath.get(entry.path);
        if (observation.status === 'matched')
            continue;
        if (observation.status === 'missing' &&
            parentDirectories(entry.path).some((parent) => observedByPath.get(parent)?.status !== 'matched')) {
            continue;
        }
        diagnostics.push({
            code: observation.status === 'missing' ? 'LAYOUT_PATH_MISSING' : 'LAYOUT_PATH_KIND_MISMATCH',
            message: observation.status === 'missing'
                ? `Declared layout path ${entry.path} does not exist.`
                : `Declared ${entry.kind} ${entry.path} is physically ${article(observation.observedKind)} ${observation.observedKind}.`,
            file: source,
            line: entry.line,
            column: entry.column,
        });
    }
    const additional = [...actual]
        .filter(([path]) => !declaredByStem.has(pathStem(path)))
        .map(([path, kind]) => ({ path, kind }))
        .sort((left, right) => compare(left.path, right.path));
    if (options.exact) {
        for (const item of additional) {
            diagnostics.push({
                code: 'LAYOUT_PATH_UNDECLARED',
                message: `Physical ${item.kind} ${item.path} is not declared in exact layout.ts.`,
                file: portable(relative(root, join(module, pathStem(item.path)))),
                line: 1,
                column: 1,
            });
        }
    }
    const observation = {
        entries: observedEntries,
        additional,
        revision: sourceRevision([
            options.exact ? 'exact' : 'sparse',
            ...ignore.map(({ source, pattern }) => `${source}:${pattern}`),
            ...[...actual]
                .sort(([left], [right]) => compare(left, right))
                .map(([path, kind]) => `${path}\0${kind}`),
        ].join('\0')),
    };
    return { observation, ignore, diagnostics };
}
async function scanPhysicalPath(catalogRoot, moduleRoot, path, output, diagnostics, policy) {
    const stem = pathStem(path);
    const relativePath = stem === '.' ? '' : stem;
    const target = relativePath ? join(moduleRoot, ...relativePath.split('/')) : moduleRoot;
    let metadata;
    try {
        metadata = await lstat(target);
    }
    catch (error) {
        if (isMissing(error))
            return;
        diagnostics.push({
            code: 'LAYOUT_OBSERVATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            file: portable(relative(catalogRoot, target)),
            line: 1,
            column: 1,
        });
        return;
    }
    const kind = metadata.isSymbolicLink()
        ? 'symbolic-link'
        : metadata.isDirectory()
            ? 'directory'
            : metadata.isFile()
                ? 'file'
                : 'other';
    const observedPath = relativePath
        ? kind === 'directory'
            ? `${relativePath}/`
            : relativePath
        : './';
    if (ignoredObservedPath(observedPath, kind, policy))
        return;
    output.set(observedPath, kind);
    if (kind !== 'directory')
        return;
    if (relativePath && (await isNestedModuleRoot(target)))
        return;
    let children;
    try {
        children = await readdir(target, { withFileTypes: true });
    }
    catch (error) {
        diagnostics.push({
            code: 'LAYOUT_OBSERVATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            file: portable(relative(catalogRoot, target)),
            line: 1,
            column: 1,
        });
        return;
    }
    children.sort((left, right) => compare(left.name, right.name));
    for (const child of children) {
        if (ignoredPhysicalChild(relativePath, child.name))
            continue;
        await scanPhysicalPath(catalogRoot, moduleRoot, relativePath ? `${relativePath}/${child.name}` : child.name, output, diagnostics, policy);
    }
}
function layoutConfiguration(source, file, object, diagnostics) {
    const entries = literalProperty(object, 'entries');
    const exact = literalProperty(object, 'exact');
    const ignore = literalProperty(object, 'ignore');
    for (const member of object.properties) {
        const name = ts.isPropertyAssignment(member) ? literalPropertyName(member.name) : undefined;
        if (name === 'entries' || name === 'exact' || name === 'ignore')
            continue;
        diagnostics.push(nodeDiagnostic('LAYOUT_OPTION_INVALID', 'Configured layouts may contain only entries, exact, and ignore.', source, file, member));
    }
    if (!entries || !ts.isArrayLiteralExpression(entries.initializer)) {
        diagnostics.push(nodeDiagnostic('LAYOUT_ENTRIES_INVALID', 'Configured layouts require one literal entries array.', source, file, entries ?? object));
        return { exact: false, ignore: [] };
    }
    let exactValue = false;
    if (exact) {
        if (exact.initializer.kind === ts.SyntaxKind.TrueKeyword)
            exactValue = true;
        else if (exact.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
            diagnostics.push(nodeDiagnostic('LAYOUT_EXACT_INVALID', 'Layout exact must be a boolean literal.', source, file, exact.initializer));
        }
    }
    const ignoreValues = [];
    if (ignore) {
        if (!ts.isArrayLiteralExpression(ignore.initializer)) {
            diagnostics.push(nodeDiagnostic('LAYOUT_IGNORE_INVALID', 'Layout ignore must be an array of relative POSIX glob string literals.', source, file, ignore.initializer));
        }
        else {
            const seen = new Set();
            for (const element of ignore.initializer.elements) {
                const pattern = stringLiteral(element);
                if (!pattern || !validIgnorePattern(pattern)) {
                    diagnostics.push(nodeDiagnostic('LAYOUT_IGNORE_PATTERN_INVALID', 'Ignore patterns must be canonical relative POSIX globs using *, **, or ?.', source, file, element));
                    continue;
                }
                if (seen.has(pattern)) {
                    diagnostics.push(nodeDiagnostic('LAYOUT_IGNORE_PATTERN_DUPLICATE', `Layout ignore pattern ${pattern} is duplicated.`, source, file, element));
                    continue;
                }
                seen.add(pattern);
                ignoreValues.push(pattern);
            }
        }
    }
    return { entries: entries.initializer, exact: exactValue, ignore: ignoreValues };
}
function layoutLiteral(expression, helper) {
    if (!helper ||
        !ts.isCallExpression(expression) ||
        !ts.isIdentifier(expression.expression) ||
        expression.expression.text !== helper ||
        expression.arguments.length !== 1) {
        return;
    }
    const argument = expression.arguments[0];
    return argument &&
        (ts.isArrayLiteralExpression(argument) || ts.isObjectLiteralExpression(argument))
        ? argument
        : undefined;
}
function effectiveIgnorePatterns(authored) {
    const patterns = new Map();
    for (const pattern of DEFAULT_LAYOUT_IGNORE_PATTERNS) {
        patterns.set(pattern, { pattern, source: 'default' });
    }
    for (const pattern of authored)
        patterns.set(pattern, { pattern, source: 'layout' });
    return [...patterns.values()];
}
function ignoredObservedPath(path, kind, policy) {
    const stem = pathStem(path);
    const declared = policy.declared.has(stem) || (kind === 'directory' && policy.requiredDirectories.has(stem));
    return !declared && policy.ignored.some((pattern) => pattern.test(path));
}
function validIgnorePattern(pattern) {
    if (!pattern ||
        pattern.trim() !== pattern ||
        isAbsolute(pattern) ||
        pattern.startsWith('./') ||
        pattern.includes('\\') ||
        pattern.includes('//') ||
        [...pattern].some((character) => isLayoutControl(character.codePointAt(0)))) {
        return false;
    }
    const segments = pattern.split('/');
    return segments.every((segment) => segment && segment !== '.' && segment !== '..');
}
function globExpression(pattern) {
    let expression = '^';
    for (let index = 0; index < pattern.length; index++) {
        const character = pattern[index];
        if (character === '*' && pattern[index + 1] === '*') {
            index++;
            if (pattern[index + 1] === '/') {
                index++;
                expression += '(?:.*/)?';
            }
            else {
                expression += '.*';
            }
        }
        else if (character === '*')
            expression += '[^/]*';
        else if (character === '?')
            expression += '[^/]';
        else
            expression += character.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
    }
    return new RegExp(`${expression}$`, 'u');
}
async function isNestedModuleRoot(directory) {
    try {
        const metadata = await lstat(join(directory, '.spec', 'api.d.ts'));
        return metadata.isFile() && !metadata.isSymbolicLink();
    }
    catch (error) {
        if (isMissing(error))
            return false;
        throw error;
    }
}
/** Repository-standard generated, local, or secret material is outside source ownership. */
function ignoredPhysicalChild(parent, name) {
    if ([
        '.context',
        '.history',
        '.git',
        '.idea',
        '.pnpm-store',
        '.spec',
        '.turbo',
        '.vscode',
        '.wrangler',
        'coverage',
        'dist',
        'node_modules',
    ].includes(name)) {
        return true;
    }
    const insideBenchmark = parent === 'benchmark' ||
        parent.startsWith('benchmark/') ||
        parent === 'benchmarks' ||
        parent.startsWith('benchmarks/');
    const insideEvidence = parent === 'evidence' || parent.startsWith('evidence/');
    const insideQualification = parent === 'qualification' || parent.startsWith('qualification/');
    if (((insideBenchmark || insideQualification) &&
        (name === 'artifacts' || name === 'evidence' || name === 'runs')) ||
        (insideEvidence && (name === 'artifacts' || name === 'runs'))) {
        return true;
    }
    if (name === '.DS_Store' ||
        name === 'Thumbs.db' ||
        name === 'deno.lock' ||
        name === 'pnpm-lock.yaml' ||
        name.endsWith('.tsbuildinfo') ||
        name.endsWith('.log') ||
        name.endsWith('.cache') ||
        name.endsWith('.local') ||
        name.endsWith('.swp') ||
        name.endsWith('.swo') ||
        (name.startsWith('.env') && name !== '.env.example')) {
        return true;
    }
    return false;
}
function literalPropertyName(name) {
    return ts.isStringLiteral(name) || ts.isIdentifier(name) ? name.text : undefined;
}
function layoutPathKind(path) {
    if (!path ||
        path.trim() !== path ||
        isAbsolute(path) ||
        path.startsWith('./') ||
        path.includes('\\') ||
        path.includes('//') ||
        [...path].some((character) => isLayoutControl(character.codePointAt(0)))) {
        return;
    }
    const stem = pathStem(path);
    const segments = stem.split('/');
    if (!stem || segments.some((segment) => !segment || segment === '.' || segment === '..'))
        return;
    return path.endsWith('/') ? 'directory' : 'file';
}
function selfSpecifyingPath(path) {
    const first = pathStem(path).split('/')[0];
    return first === '.spec' || first === '.context' || first === '.history';
}
function parentDirectories(path) {
    const segments = pathStem(path).split('/');
    return segments
        .slice(0, -1)
        .map((_segment, index) => `${segments.slice(0, index + 1).join('/')}/`);
}
function pathStem(path) {
    return path.endsWith('/') ? path.slice(0, -1) : path;
}
function isMissing(error) {
    return Boolean(error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT');
}
function article(kind) {
    return kind === 'other' ? 'an' : 'a';
}
function isLayoutControl(code) {
    return code <= 0x1f || code === 0x7f;
}
function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=layout.js.map