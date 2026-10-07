import ts from 'typescript'

import type { Diagnostic } from '../../source/diagnostic.ts'
import type {
  BenchmarkSpecification,
  CapabilitySpecification,
  LawSpecification,
  StateSpecification,
} from '../resource/index.ts'
import type { TestEvidenceReference } from '../../authoring/evidence.ts'
import type { SemanticReference } from '../../authoring/reference.ts'

import { isDescendantModulePath, semanticReferenceKey } from '../capability.ts'
import {
  AUTHORING_SPECIFIER,
  authoredSourceFile,
  authoringHelperBinding,
  calledObjectLiteral as descriptorObject,
  isAuthoringSpecifier,
  literalProperty as property,
  literalPropertyName as propertyName,
  nodeDiagnostic as diagnostic,
  plainStringLiteral,
  syntaxDiagnostics,
} from './authoring-syntax.ts'

const SEMANTIC_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/

export type DescriptorKind = 'capability' | 'law' | 'state' | 'benchmark'

export interface DescriptorDefinitions {
  readonly capability: readonly CapabilitySpecification[]
  readonly law: readonly LawSpecification[]
  readonly state: readonly StateSpecification[]
  readonly benchmark: readonly BenchmarkSpecification[]
}

export interface DescriptorCompilation<Kind extends DescriptorKind> {
  readonly definitions: DescriptorDefinitions[Kind]
  readonly diagnostics: readonly Diagnostic[]
}

/** Extract a deliberately small literal descriptor language without importing or executing it. */
export function compileDescriptor<Kind extends DescriptorKind>(
  kind: Kind,
  source: string,
  text: string,
): DescriptorCompilation<Kind> {
  const diagnostics = syntaxDiagnostics(source, text)
  const file = authoredSourceFile(source, text)
  const helper = authoringHelperBinding(file, helperName(kind))
  const definitions: unknown[] = []

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !isAuthoringSpecifier(statement.moduleSpecifier.text)
      ) {
        diagnostics.push(
          diagnostic(
            'MODULE_DESCRIPTOR_IMPORT_INVALID',
            `Descriptor files may import only ${AUTHORING_SPECIFIER}.`,
            source,
            file,
            statement,
          ),
        )
      }
      continue
    }
    if (!ts.isVariableStatement(statement) || !hasExport(statement.modifiers)) {
      diagnostics.push(
        diagnostic(
          'MODULE_DESCRIPTOR_STATEMENT_INVALID',
          'Descriptor files may contain only authoring imports and exported descriptor constants.',
          source,
          file,
          statement,
        ),
      )
      continue
    }
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
      diagnostics.push(
        diagnostic(
          'MODULE_DESCRIPTOR_MUTABLE',
          'Descriptor exports must be declared with const.',
          source,
          file,
          statement.declarationList,
        ),
      )
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        diagnostics.push(
          diagnostic(
            'MODULE_DESCRIPTOR_EXPORT_INVALID',
            'Descriptor exports must be initialized named constants.',
            source,
            file,
            declaration,
          ),
        )
        continue
      }
      const object = descriptorObject(declaration.initializer, helper)
      if (!object) {
        diagnostics.push(
          diagnostic(
            'MODULE_DESCRIPTOR_EXPORT_INVALID',
            `Export ${declaration.name.text} must call ${helperName(kind)} imported from ${AUTHORING_SPECIFIER}.`,
            source,
            file,
            declaration,
          ),
        )
        continue
      }
      const definition = definitionOf(
        kind,
        declaration.name.text,
        object,
        source,
        file,
        diagnostics,
      )
      if (definition) definitions.push(definition)
    }
  }

  if (definitions.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      code: 'MODULE_DESCRIPTOR_MISSING',
      message: `The file must export at least one ${helperName(kind)} declaration.`,
      file: source,
      line: 1,
      column: 1,
    })
  }
  duplicateDefinitionDiagnostics(kind, definitions, source, diagnostics)
  return {
    definitions: definitions as unknown as DescriptorDefinitions[Kind],
    diagnostics,
  }
}

function definitionOf(
  kind: DescriptorKind,
  exportName: string,
  object: ts.ObjectLiteralExpression,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
):
  | CapabilitySpecification
  | LawSpecification
  | StateSpecification
  | BenchmarkSpecification
  | undefined {
  validateProperties(
    object,
    new Set(
      kind === 'capability'
        ? ['id', 'statement', 'laws', 'capabilities']
        : kind === 'law'
          ? ['id', 'statement', 'formal', 'tests']
          : kind === 'benchmark'
            ? ['id', 'statement', 'workload', 'metrics', 'capability', 'assumptions']
            : ['initial', 'transitions', 'tests'],
    ),
    source,
    file,
    diagnostics,
  )
  if (kind === 'state') return stateDefinition(exportName, object, source, file, diagnostics)
  const id = requiredString(object, 'id', source, file, diagnostics)
  const statement = requiredString(object, 'statement', source, file, diagnostics)
  if (!id || !statement) return
  if (!SEMANTIC_ID.test(id)) {
    diagnostics.push(
      propertyDiagnostic(
        object,
        'id',
        'SEMANTIC_ID_INVALID',
        'Semantic identifiers must contain hierarchical uppercase segments separated by hyphens.',
        source,
        file,
      ),
    )
  }
  const expectedExport = id.replaceAll('-', '_')
  if (exportName !== expectedExport) {
    diagnostics.push(
      diagnostic(
        'MODULE_DESCRIPTOR_EXPORT_MISMATCH',
        `Descriptor ${id} must be exported as ${expectedExport}.`,
        source,
        file,
        object.parent,
      ),
    )
  }
  if (kind === 'capability') {
    const laws = optionalSemanticReferences(object, 'laws', id, source, file, diagnostics)
    const capabilities = optionalSemanticReferences(
      object,
      'capabilities',
      id,
      source,
      file,
      diagnostics,
    )
    return {
      exportName,
      id,
      statement,
      ...(laws ? { laws } : {}),
      ...(capabilities ? { capabilities } : {}),
    }
  }
  if (kind === 'law') {
    const formal = optionalString(object, 'formal', source, file, diagnostics)
    const tests = optionalEvidenceReferences(object, 'tests', source, file, diagnostics)
    return {
      exportName,
      id,
      statement,
      ...(formal ? { formal } : {}),
      ...(tests ? { tests } : {}),
      testEvidence: [],
    }
  }

  const workload = requiredString(object, 'workload', source, file, diagnostics)
  const metrics = requiredStringArray(object, 'metrics', source, file, diagnostics)
  const capability = optionalString(object, 'capability', source, file, diagnostics)
  const assumptions = optionalStringArray(object, 'assumptions', source, file, diagnostics)
  if (!workload || !metrics) return
  return {
    exportName,
    id,
    statement,
    workload,
    metrics,
    ...(capability ? { capability } : {}),
    ...(assumptions ? { assumptions } : {}),
  }
}

function stateDefinition(
  exportName: string,
  object: ts.ObjectLiteralExpression,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): StateSpecification | undefined {
  const transitionsProperty = property(object, 'transitions')
  if (!transitionsProperty || !ts.isObjectLiteralExpression(transitionsProperty.initializer)) {
    diagnostics.push(
      propertyDiagnostic(
        object,
        'transitions',
        'STATE_TRANSITIONS_INVALID',
        'State transitions must be an object literal.',
        source,
        file,
      ),
    )
    return
  }
  const transitions: Record<string, Readonly<Record<string, string>>> = {}
  for (const stateProperty of transitionsProperty.initializer.properties) {
    if (!ts.isPropertyAssignment(stateProperty)) {
      diagnostics.push(
        diagnostic(
          'STATE_TRANSITIONS_INVALID',
          'State entries must be direct property assignments.',
          source,
          file,
          stateProperty,
        ),
      )
      continue
    }
    const state = propertyName(stateProperty.name)
    if (!state || !ts.isObjectLiteralExpression(stateProperty.initializer)) {
      diagnostics.push(
        diagnostic(
          'STATE_TRANSITIONS_INVALID',
          'Every state must have a literal event-to-target object.',
          source,
          file,
          stateProperty,
        ),
      )
      continue
    }
    const events: Record<string, string> = {}
    for (const eventProperty of stateProperty.initializer.properties) {
      if (!ts.isPropertyAssignment(eventProperty)) {
        diagnostics.push(
          diagnostic(
            'STATE_TRANSITIONS_INVALID',
            'State events must be direct property assignments.',
            source,
            file,
            eventProperty,
          ),
        )
        continue
      }
      const event = propertyName(eventProperty.name)
      const target = stringLiteral(eventProperty.initializer)
      if (!event || !target) {
        diagnostics.push(
          diagnostic(
            'STATE_TRANSITION_TARGET_INVALID',
            'State event names and targets must be non-empty string literals.',
            source,
            file,
            eventProperty,
          ),
        )
        continue
      }
      if (Object.hasOwn(events, event)) {
        diagnostics.push(
          diagnostic(
            'STATE_EVENT_DUPLICATE',
            `State ${state} declares event ${event} more than once.`,
            source,
            file,
            eventProperty,
          ),
        )
      }
      events[event] = target
    }
    if (Object.hasOwn(transitions, state)) {
      diagnostics.push(
        diagnostic(
          'STATE_DUPLICATE',
          `State ${state} is declared more than once.`,
          source,
          file,
          stateProperty,
        ),
      )
    }
    transitions[state] = events
  }
  const states = new Set(Object.keys(transitions))
  if (states.size === 0) {
    diagnostics.push(
      propertyDiagnostic(
        object,
        'transitions',
        'STATE_EMPTY',
        'A state definition must contain at least one state.',
        source,
        file,
      ),
    )
  }
  for (const [state, events] of Object.entries(transitions)) {
    for (const [event, target] of Object.entries(events)) {
      if (!states.has(target)) {
        diagnostics.push({
          code: 'STATE_TARGET_UNKNOWN',
          message: `${state} + ${event} targets undeclared state ${target}.`,
          file: source,
          line: 1,
          column: 1,
          pointer: `/state/${encodeURIComponent(state)}/event/${encodeURIComponent(event)}`,
        })
      }
    }
  }
  const initial = optionalString(object, 'initial', source, file, diagnostics)
  const tests = optionalEvidenceReferences(object, 'tests', source, file, diagnostics)
  if (initial && !states.has(initial)) {
    diagnostics.push(
      propertyDiagnostic(
        object,
        'initial',
        'STATE_INITIAL_UNKNOWN',
        `Initial state ${initial} is not declared by transitions.`,
        source,
        file,
      ),
    )
  }
  return {
    exportName,
    transitions,
    ...(initial ? { initial } : {}),
    ...(tests ? { tests } : {}),
    testEvidence: [],
  }
}

function helperName(kind: DescriptorKind): string {
  return {
    capability: 'defineCapability',
    law: 'defineLaw',
    state: 'defineState',
    benchmark: 'defineBenchmark',
  }[kind]
}

function requiredString(
  object: ts.ObjectLiteralExpression,
  name: string,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): string | undefined {
  const value = optionalString(object, name, source, file, diagnostics)
  if (value) return value
  if (!property(object, name)) {
    diagnostics.push(
      propertyDiagnostic(
        object,
        name,
        'MODULE_DESCRIPTOR_FIELD_MISSING',
        `Descriptor field ${name} is required.`,
        source,
        file,
      ),
    )
  }
  return
}

function optionalString(
  object: ts.ObjectLiteralExpression,
  name: string,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): string | undefined {
  const member = property(object, name)
  if (!member) return
  const value = stringLiteral(member.initializer)
  if (!value || value.trim() !== value) {
    diagnostics.push(
      diagnostic(
        'MODULE_DESCRIPTOR_FIELD_INVALID',
        `Descriptor field ${name} must be a non-empty, trimmed string literal.`,
        source,
        file,
        member,
      ),
    )
    return
  }
  return value
}

function requiredStringArray(
  object: ts.ObjectLiteralExpression,
  name: string,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): readonly string[] | undefined {
  const value = optionalStringArray(object, name, source, file, diagnostics)
  if (value?.length) return value
  if (!property(object, name)) {
    diagnostics.push(
      propertyDiagnostic(
        object,
        name,
        'MODULE_DESCRIPTOR_FIELD_MISSING',
        `Descriptor field ${name} is required.`,
        source,
        file,
      ),
    )
  } else if (value?.length === 0) {
    diagnostics.push(
      propertyDiagnostic(
        object,
        name,
        'MODULE_DESCRIPTOR_FIELD_INVALID',
        `Descriptor field ${name} must contain at least one value.`,
        source,
        file,
      ),
    )
  }
  return
}

function optionalStringArray(
  object: ts.ObjectLiteralExpression,
  name: string,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): readonly string[] | undefined {
  const member = property(object, name)
  if (!member) return
  if (!ts.isArrayLiteralExpression(member.initializer)) {
    diagnostics.push(
      diagnostic(
        'MODULE_DESCRIPTOR_FIELD_INVALID',
        `Descriptor field ${name} must be an array of non-empty string literals.`,
        source,
        file,
        member,
      ),
    )
    return
  }
  const values = member.initializer.elements.map(stringLiteral)
  if (values.some((value) => !value || value.trim() !== value)) {
    diagnostics.push(
      diagnostic(
        'MODULE_DESCRIPTOR_FIELD_INVALID',
        `Descriptor field ${name} must contain only non-empty, trimmed string literals.`,
        source,
        file,
        member,
      ),
    )
    return
  }
  const strings = values as string[]
  if (new Set(strings).size !== strings.length) {
    diagnostics.push(
      diagnostic(
        'MODULE_DESCRIPTOR_FIELD_DUPLICATE',
        `Descriptor field ${name} contains duplicate values.`,
        source,
        file,
        member,
      ),
    )
    return
  }
  return strings
}

function optionalEvidenceReferences(
  object: ts.ObjectLiteralExpression,
  name: string,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): readonly TestEvidenceReference[] | undefined {
  const member = property(object, name)
  if (!member) return
  if (!ts.isArrayLiteralExpression(member.initializer)) {
    diagnostics.push(
      diagnostic(
        'MODULE_DESCRIPTOR_FIELD_INVALID',
        `Descriptor field ${name} must be an array of { file, id } literals.`,
        source,
        file,
        member,
      ),
    )
    return
  }
  const values: TestEvidenceReference[] = []
  for (const element of member.initializer.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      diagnostics.push(
        diagnostic(
          'MODULE_DESCRIPTOR_FIELD_INVALID',
          `Descriptor field ${name} must contain only { file, id } literals.`,
          source,
          file,
          element,
        ),
      )
      continue
    }
    validateProperties(element, new Set(['file', 'id']), source, file, diagnostics)
    const evidenceFile = requiredString(element, 'file', source, file, diagnostics)
    const id = requiredString(element, 'id', source, file, diagnostics)
    if (!evidenceFile || !id) continue
    if (!SEMANTIC_ID.test(id)) {
      diagnostics.push(
        propertyDiagnostic(
          element,
          'id',
          'TEST_EVIDENCE_ID_INVALID',
          'Test evidence identifiers must contain hierarchical uppercase segments separated by hyphens.',
          source,
          file,
        ),
      )
      continue
    }
    values.push({ file: evidenceFile, id })
  }
  const identities = values.map(({ file, id }) => `${file}\0${id}`)
  if (new Set(identities).size !== identities.length) {
    diagnostics.push(
      diagnostic(
        'MODULE_DESCRIPTOR_FIELD_DUPLICATE',
        `Descriptor field ${name} contains duplicate evidence identities.`,
        source,
        file,
        member,
      ),
    )
    return
  }
  return values
}

function optionalSemanticReferences(
  object: ts.ObjectLiteralExpression,
  name: 'laws' | 'capabilities',
  capability: string,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): readonly SemanticReference[] | undefined {
  const member = property(object, name)
  if (!member) return
  if (!ts.isArrayLiteralExpression(member.initializer)) {
    diagnostics.push(
      diagnostic(
        'MODULE_DESCRIPTOR_FIELD_INVALID',
        `Descriptor field ${name} must be an array of semantic identifiers or { module, id } literals.`,
        source,
        file,
        member,
      ),
    )
    return
  }
  const values: SemanticReference[] = []
  const seen = new Set<string>()
  for (const element of member.initializer.elements) {
    const reference = semanticReference(element, name, source, file, diagnostics)
    if (!reference) continue
    const identity = semanticReferenceKey(reference)
    if (seen.has(identity)) {
      diagnostics.push(
        diagnostic(
          'CAPABILITY_REFERENCE_DUPLICATE',
          `Capability ${capability} cites ${describeSemanticReference(reference)} more than once in ${name}.`,
          source,
          file,
          element,
        ),
      )
      continue
    }
    seen.add(identity)
    values.push(reference)
  }
  return values
}

function semanticReference(
  element: ts.Expression,
  name: string,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): SemanticReference | undefined {
  const local = stringLiteral(element)
  if (local !== undefined) {
    if (SEMANTIC_ID.test(local)) return local
  } else if (ts.isObjectLiteralExpression(element)) {
    validateProperties(element, new Set(['module', 'id']), source, file, diagnostics)
    const module = requiredString(element, 'module', source, file, diagnostics)
    const id = requiredString(element, 'id', source, file, diagnostics)
    if (!module || !id) return
    if (!isDescendantModulePath(module)) {
      diagnostics.push(
        propertyDiagnostic(
          element,
          'module',
          'CAPABILITY_MODULE_INVALID',
          'A cited module must be a POSIX path to a strict descendant module: no leading ./ or /, and no . or .. segment.',
          source,
          file,
        ),
      )
      return
    }
    if (SEMANTIC_ID.test(id)) return { module, id }
  }
  diagnostics.push(
    diagnostic(
      'MODULE_DESCRIPTOR_FIELD_INVALID',
      `Descriptor field ${name} must contain only semantic identifiers or { module, id } literals.`,
      source,
      file,
      element,
    ),
  )
  return
}

function describeSemanticReference(reference: SemanticReference): string {
  return typeof reference === 'string' ? reference : `${reference.id} in module ${reference.module}`
}

function validateProperties(
  object: ts.ObjectLiteralExpression,
  allowed: ReadonlySet<string>,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): void {
  const seen = new Set<string>()
  for (const member of object.properties) {
    const name = ts.isPropertyAssignment(member) ? propertyName(member.name) : undefined
    if (!name || !allowed.has(name)) {
      diagnostics.push(
        diagnostic(
          'MODULE_DESCRIPTOR_FIELD_UNKNOWN',
          'Descriptor definitions may contain only their documented literal fields.',
          source,
          file,
          member,
        ),
      )
      continue
    }
    if (seen.has(name)) {
      diagnostics.push(
        diagnostic(
          'MODULE_DESCRIPTOR_FIELD_DUPLICATE',
          `Descriptor field ${name} is declared more than once.`,
          source,
          file,
          member,
        ),
      )
    }
    seen.add(name)
  }
}

function stringLiteral(expression: ts.Expression): string | undefined {
  const plain = plainStringLiteral(expression)
  if (plain !== undefined) return plain
  if (
    ts.isTaggedTemplateExpression(expression) &&
    ts.isPropertyAccessExpression(expression.tag) &&
    ts.isIdentifier(expression.tag.expression) &&
    expression.tag.expression.text === 'String' &&
    expression.tag.name.text === 'raw' &&
    ts.isNoSubstitutionTemplateLiteral(expression.template)
  ) {
    return expression.template.rawText ?? expression.template.text
  }
  return
}

function hasExport(modifiers: ts.NodeArray<ts.ModifierLike> | undefined): boolean {
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function duplicateDefinitionDiagnostics(
  kind: DescriptorKind,
  definitions: readonly unknown[],
  source: string,
  diagnostics: Diagnostic[],
): void {
  const seen = new Set<string>()
  for (const definition of definitions as readonly { exportName: string; id?: string }[]) {
    const identity = definition.id ?? definition.exportName
    if (seen.has(identity)) {
      diagnostics.push({
        code: 'MODULE_DESCRIPTOR_DUPLICATE',
        message: `${helperName(kind)} identity ${identity} is declared more than once in this file.`,
        file: source,
        line: 1,
        column: 1,
      })
    }
    seen.add(identity)
  }
}

function propertyDiagnostic(
  object: ts.ObjectLiteralExpression,
  name: string,
  code: string,
  message: string,
  source: string,
  file: ts.SourceFile,
): Diagnostic {
  return diagnostic(code, message, source, file, property(object, name) ?? object)
}

/**
 * Locate one authored descriptor value for a diagnostic derived after extraction.
 *
 * The path names literal fields; a reference step selects the first array element spelling that
 * exact semantic reference. An unknown step falls back to the nearest located ancestor.
 */
export function locateDescriptorValue(
  source: string,
  text: string,
  exportName: string,
  path: readonly (string | { readonly reference: SemanticReference })[] = [],
): { readonly line: number; readonly column: number } {
  const file = authoredSourceFile(source, text)
  let node: ts.Node | undefined
  let value: ts.Expression | undefined
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue
      node = declaration
      const argument =
        declaration.initializer && ts.isCallExpression(declaration.initializer)
          ? declaration.initializer.arguments[0]
          : undefined
      value = argument
    }
  }
  if (!node) return { line: 1, column: 1 }
  for (const step of path) {
    if (!value) break
    if (typeof step === 'string') {
      if (!ts.isObjectLiteralExpression(value)) break
      const member = property(value, step)
      if (!member) break
      node = member
      value = member.initializer
      continue
    }
    if (!ts.isArrayLiteralExpression(value)) break
    const identity = semanticReferenceKey(step.reference)
    const element = value.elements.find((candidate) => {
      const authored = authoredSemanticReference(candidate)
      return authored !== undefined && semanticReferenceKey(authored) === identity
    })
    if (!element) break
    node = element
    value = element
  }
  const position = file.getLineAndCharacterOfPosition(node.getStart(file))
  return { line: position.line + 1, column: position.character + 1 }
}

function authoredSemanticReference(element: ts.Expression): SemanticReference | undefined {
  const local = stringLiteral(element)
  if (local !== undefined) return local
  if (!ts.isObjectLiteralExpression(element)) return
  const module = property(element, 'module')
  const id = property(element, 'id')
  const moduleValue = module ? stringLiteral(module.initializer) : undefined
  const idValue = id ? stringLiteral(id.initializer) : undefined
  return moduleValue !== undefined && idValue !== undefined
    ? { module: moduleValue, id: idValue }
    : undefined
}
