import { isAbsolute } from 'node:path';
import ts from 'typescript';
/**
 * Project only the external identities an authored declaration names.
 *
 * This is intentionally syntax-directed: compiling an API must not parse, normalize, or depend on
 * the internal declaration graph of Zod (or any other installed package). A named import may itself
 * be a namespace export, so qualified use such as `z.ZodType` determines that topology locally.
 */
export function collectExternalReferences(source) {
    const references = [];
    const bindings = new Map();
    for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            const specifier = statement.moduleSpecifier.text;
            if (isExternalSpecifier(specifier)) {
                collectImport(statement, specifier, references, bindings);
            }
        }
        else if (ts.isExportDeclaration(statement) &&
            statement.moduleSpecifier &&
            ts.isStringLiteral(statement.moduleSpecifier)) {
            const specifier = statement.moduleSpecifier.text;
            if (isExternalSpecifier(specifier))
                collectExport(statement, specifier, references);
        }
        else if (ts.isImportEqualsDeclaration(statement) &&
            ts.isExternalModuleReference(statement.moduleReference) &&
            statement.moduleReference.expression &&
            ts.isStringLiteral(statement.moduleReference.expression) &&
            isExternalSpecifier(statement.moduleReference.expression.text)) {
            const specifier = statement.moduleReference.expression.text;
            if (!statement.isTypeOnly) {
                throw new Error(`External API imports must be type-only: ${specifier}`);
            }
            references.push(moduleReference(specifier));
            bindings.set(statement.name.text, { specifier, path: [] });
        }
    }
    // Ordinary local declarations dominate the corpus. Avoid another full AST walk unless a bound
    // external name or a static import-type expression can actually contribute an identity.
    if (!bindings.size && !/\bimport\s*\(/u.test(source.text))
        return deduplicate(references);
    const visit = (node) => {
        if (ts.isTypeReferenceNode(node)) {
            collectBoundReference(entityPath(node.typeName), 'type', node.typeArguments?.length ?? 0, bindings, references);
        }
        else if (ts.isIndexedAccessTypeNode(node)) {
            const owner = typeReferencePath(node.objectType);
            const member = indexedAccessMember(node.indexType);
            if (owner && member) {
                collectBoundReference([...owner, member], callableIndexedAccess(node) ? 'callable-member' : 'member', 0, bindings, references);
            }
        }
        else if (ts.isExpressionWithTypeArguments(node)) {
            collectBoundReference(expressionPath(node.expression), 'heritage', node.typeArguments?.length ?? 0, bindings, references);
        }
        else if (ts.isTypeQueryNode(node)) {
            if (!ts.isImportTypeNode(node.exprName)) {
                collectBoundReference(entityPath(node.exprName), 'value', 0, bindings, references);
            }
        }
        else if (ts.isImportTypeNode(node)) {
            collectImportType(node, references);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return deduplicate(references);
}
/** Merge entrypoint projections into one virtual module source per package specifier. */
export function renderExternalModules(groups) {
    const modules = new Map();
    for (const references of groups) {
        for (const reference of references) {
            const root = modules.get(reference.specifier) ?? externalNode();
            modules.set(reference.specifier, root);
            if (reference.kind === 'module' && reference.path.length === 0)
                continue;
            const node = nodeAt(root, reference.path);
            if (reference.kind === 'import')
                node.imported = true;
            else if (reference.kind === 'type' || reference.kind === 'heritage') {
                node.typeArity = Math.max(node.typeArity ?? 0, reference.arity);
                if (reference.kind === 'heritage')
                    node.heritage = true;
            }
            else if (reference.kind === 'member' || reference.kind === 'callable-member') {
                node.member = true;
                if (reference.kind === 'callable-member')
                    node.callableMember = true;
            }
            else if (reference.kind === 'value')
                node.value = true;
        }
    }
    return new Map([...modules]
        .sort(([left], [right]) => compare(left, right))
        .map(([specifier, root]) => [specifier, renderModule(root)]));
}
export function isExternalSpecifier(specifier) {
    return !specifier.startsWith('.') && !isAbsolute(specifier);
}
function collectImport(declaration, specifier, references, bindings) {
    const clause = declaration.importClause;
    if (!clause)
        throw new Error(`External API imports must bind types: ${specifier}`);
    references.push(moduleReference(specifier));
    if (clause.name) {
        if (!clause.isTypeOnly)
            throw new Error(`External API imports must be type-only: ${specifier}`);
        const path = ['default'];
        references.push({ specifier, path, kind: 'import', arity: 0 });
        bindings.set(clause.name.text, { specifier, path });
    }
    const named = clause.namedBindings;
    if (!named)
        return;
    if (ts.isNamespaceImport(named)) {
        if (!clause.isTypeOnly)
            throw new Error(`External API imports must be type-only: ${specifier}`);
        bindings.set(named.name.text, { specifier, path: [] });
        return;
    }
    for (const element of named.elements) {
        if (!clause.isTypeOnly && !element.isTypeOnly) {
            throw new Error(`External API imports must be type-only: ${specifier}`);
        }
        const name = (element.propertyName ?? element.name).text;
        const path = [name];
        references.push({ specifier, path, kind: 'import', arity: 0 });
        bindings.set(element.name.text, { specifier, path });
    }
}
function collectExport(declaration, specifier, references) {
    references.push(moduleReference(specifier));
    if (!declaration.exportClause || !ts.isNamedExports(declaration.exportClause)) {
        throw new Error(`External star API exports are unsupported: ${specifier}`);
    }
    for (const element of declaration.exportClause.elements) {
        const typeOnly = declaration.isTypeOnly || element.isTypeOnly;
        references.push({
            specifier,
            path: [(element.propertyName ?? element.name).text],
            kind: 'import',
            arity: 0,
        });
        if (!typeOnly) {
            references.push({
                specifier,
                path: [(element.propertyName ?? element.name).text],
                kind: 'value',
                arity: 0,
            });
        }
    }
}
function collectBoundReference(path, kind, arity, bindings, references) {
    if (!path?.length)
        return;
    const binding = bindings.get(path[0]);
    if (!binding)
        return;
    references.push({
        specifier: binding.specifier,
        path: [...binding.path, ...path.slice(1)],
        kind,
        arity,
    });
}
function collectImportType(node, references) {
    if (!ts.isLiteralTypeNode(node.argument) || !ts.isStringLiteral(node.argument.literal))
        return;
    const specifier = node.argument.literal.text;
    if (!isExternalSpecifier(specifier))
        return;
    references.push(moduleReference(specifier));
    const path = node.qualifier ? entityPath(node.qualifier) : [];
    if (!path.length)
        return;
    references.push({
        specifier,
        path,
        kind: node.isTypeOf ? 'value' : 'type',
        arity: node.typeArguments?.length ?? 0,
    });
}
function moduleReference(specifier) {
    return { specifier, path: [], kind: 'module', arity: 0 };
}
function entityPath(name) {
    const path = [];
    let current = name;
    while (ts.isQualifiedName(current)) {
        path.push(current.right.text);
        current = current.left;
    }
    path.push(current.text);
    return path.reverse();
}
function expressionPath(expression) {
    const path = [];
    let current = expression;
    while (ts.isPropertyAccessExpression(current)) {
        path.push(current.name.text);
        current = current.expression;
    }
    if (!ts.isIdentifier(current))
        return;
    path.push(current.text);
    return path.reverse();
}
function typeReferencePath(node) {
    return ts.isTypeReferenceNode(node) ? entityPath(node.typeName) : undefined;
}
function indexedAccessMember(node) {
    return ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)
        ? node.literal.text
        : undefined;
}
function callableIndexedAccess(node) {
    const parent = node.parent;
    return Boolean(parent &&
        ts.isTypeReferenceNode(parent) &&
        ts.isIdentifier(parent.typeName) &&
        parent.typeName.text === 'ReturnType');
}
function deduplicate(references) {
    const values = new Map();
    for (const reference of references) {
        const key = `${reference.specifier}\0${reference.path.join('.')}\0${reference.kind}`;
        const current = values.get(key);
        if (!current || reference.arity > current.arity)
            values.set(key, reference);
    }
    return [...values.values()].sort((left, right) => compare(left.specifier, right.specifier) ||
        compare(left.path.join('.'), right.path.join('.')) ||
        compare(left.kind, right.kind));
}
function externalNode() {
    return {
        imported: false,
        heritage: false,
        member: false,
        callableMember: false,
        value: false,
        children: new Map(),
    };
}
function nodeAt(root, path) {
    let current = root;
    for (const name of path) {
        const child = current.children.get(name) ?? externalNode();
        current.children.set(name, child);
        current = child;
    }
    return current;
}
function renderModule(root) {
    const declarations = [];
    const defaultNode = root.children.get('default');
    for (const [name, node] of [...root.children].sort(([left], [right]) => compare(left, right))) {
        if (name === 'default')
            continue;
        declarations.push(...renderNamed(name, node, '', true));
    }
    if (defaultNode)
        declarations.push(...renderDefault(root, defaultNode));
    if (!declarations.length)
        declarations.push('export {}');
    return `${declarations.join('\n')}\n`;
}
function renderDefault(root, node) {
    let local = '__AstraleExternalDefault';
    while (root.children.has(local))
        local += '_';
    const declarations = [`declare class ${local}${typeParameters(node.typeArity ?? 0)} {}`];
    if (node.children.size) {
        declarations.push(`declare namespace ${local} {`);
        declarations.push(...renderChildren(node, '  '));
        declarations.push('}');
    }
    declarations.push(`export default ${local}`);
    return declarations;
}
function renderNamed(name, node, indent, exported) {
    if (!/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(name)) {
        throw new Error(`External API export name is unsupported: ${JSON.stringify(name)}`);
    }
    const prefix = exported ? 'export ' : '';
    const declarations = [];
    const members = [...node.children].filter(([, child]) => child.member);
    const namespaceChildren = [...node.children].filter(([, child]) => !child.member);
    if (node.member) {
        declarations.push(`${indent}${prefix}interface ${name}${typeParameters(node.typeArity ?? 0)} {}`);
    }
    else if (node.imported && node.value) {
        declarations.push(`${indent}${prefix}declare class ${name}${typeParameters(node.typeArity ?? 0)} {}`);
        if (node.children.size) {
            declarations.push(`${indent}${prefix}namespace ${name} {`);
            declarations.push(...renderChildren(node, `${indent}  `));
            declarations.push(`${indent}}`);
        }
        return declarations;
    }
    if (node.children.size) {
        if (node.typeArity !== undefined || members.length) {
            declarations.push(`${indent}${prefix}interface ${name}${typeParameters(node.typeArity ?? 0)} {`);
            for (const [memberName, member] of members) {
                const value = member.callableMember ? '(...args: never[]) => unknown' : 'unknown';
                declarations.push(`${indent}  readonly ${memberName}: ${value}`);
            }
            declarations.push(`${indent}}`);
        }
        if (namespaceChildren.length) {
            declarations.push(`${indent}${prefix}namespace ${name} {`);
            declarations.push(...namespaceChildren.flatMap(([childName, child]) => renderNamed(childName, child, `${indent}  `, true)));
            declarations.push(`${indent}}`);
        }
        return declarations;
    }
    if (node.typeArity !== undefined && node.value) {
        declarations.push(`${indent}${prefix}interface ${name}${typeParameters(node.typeArity)} {}`);
        declarations.push(`${indent}${prefix}declare const ${name}: unknown`);
    }
    else if (node.heritage) {
        declarations.push(`${indent}${prefix}interface ${name}${typeParameters(node.typeArity ?? 0)} {}`);
    }
    else if (node.typeArity !== undefined || node.imported) {
        declarations.push(`${indent}${prefix}type ${name}${typeParameters(node.typeArity ?? 0)} = unknown`);
    }
    else if (node.value) {
        declarations.push(`${indent}${prefix}declare const ${name}: unknown`);
    }
    return declarations;
}
function renderChildren(node, indent) {
    return [...node.children]
        .sort(([left], [right]) => compare(left, right))
        .flatMap(([name, child]) => renderNamed(name, child, indent, true));
}
function typeParameters(arity) {
    if (!arity)
        return '';
    return `<${Array.from({ length: arity }, (_, index) => `T${index} = unknown`).join(', ')}>`;
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=external.js.map