import type {
  DeclarationIdentity,
  ExpectedDeclaration,
  ExpectedExport,
  ExpectedPackage,
  ExpectedType,
  ProofObligation,
} from './model.ts'

export function compileObligations(
  moduleName: string,
  apiPointer: string,
  declarations: ReadonlyMap<string, ExpectedDeclaration>,
  exports: readonly ExpectedExport[],
  imports: readonly DeclarationIdentity[],
  packages: readonly ExpectedPackage[],
): ProofObligation[] {
  const obligations: ProofObligation[] = [
    { id: `module.${moduleName}`, kind: 'module', pointer: apiPointer, label: moduleName },
  ]
  for (const item of exports) {
    obligations.push({
      id: `module.export.${item.path.join('.')}.${item.declaration.kind}`,
      kind: 'export',
      pointer: item.pointer,
      label: item.path.join('.'),
    })
  }
  for (const declaration of declarations.values()) {
    const prefix = `module.${declaration.identity.kind}.${proofIdentity(declaration.identity)}`
    obligations.push({
      id: prefix,
      kind: 'declaration',
      pointer: declaration.pointer,
      label: declaration.identity.name,
    })
    for (const parameter of declaration.typeParameters ?? []) {
      obligations.push({
        id: `${prefix}.type-parameter.${parameter.index}`,
        kind: 'type-parameter',
        pointer: parameter.pointer,
        label: `${declaration.identity.name}<${parameter.name}>`,
      })
    }
    for (const parameter of declaration.callableTypeParameters ?? []) {
      obligations.push({
        id: `${prefix}.call-signature.type-parameter.${parameter.index}`,
        kind: 'type-parameter',
        pointer: parameter.pointer,
        label: `${declaration.identity.name} call signature <${parameter.name}>`,
      })
    }
    if (declaration.facets) {
      obligations.push({
        id: `${prefix}.facet.type`,
        kind: 'type-facet',
        pointer: declaration.facets.type.pointer,
        label: `${declaration.identity.name} type facet`,
      })
      obligations.push({
        id: `${prefix}.facet.value`,
        kind: 'value-facet',
        pointer: declaration.facets.value.pointer,
        label: `${declaration.identity.name} value facet`,
      })
      if (declaration.facets.type.valueType) {
        obligations.push({
          id: `${prefix}.facet.type.value`,
          kind: 'value-type',
          pointer: declaration.facets.type.valueType.pointer,
          label: `${declaration.identity.name} type-facet value`,
        })
      }
      for (const parameter of declaration.facets.type.typeParameters ?? []) {
        obligations.push({
          id: `${prefix}.facet.type.type-parameter.${parameter.index}`,
          kind: 'type-parameter',
          pointer: parameter.pointer,
          label: `${declaration.identity.name} type facet <${parameter.name}>`,
        })
      }
      if (declaration.facets.value.kind === 'value') {
        obligations.push({
          id: `${prefix}.facet.value.type`,
          kind: 'value-type',
          pointer: declaration.facets.value.valueType.pointer,
          label: `${declaration.identity.name} value-facet type`,
        })
      }
    }
    if (declaration.valueType) {
      obligations.push({
        id: `${prefix}.type`,
        kind: 'value-type',
        pointer: declaration.valueType.pointer,
        label: `${declaration.identity.name} type`,
      })
    }
    for (const [category, members] of [
      ['field', declaration.fields],
      ['property', declaration.properties],
      ['callable', declaration.callables],
      ['static', declaration.statics],
    ] as const) {
      for (const member of members ?? []) {
        obligations.push({
          id: `${prefix}.${category}.${member.name}`,
          kind: 'member',
          pointer: member.pointer,
          label: `${declaration.identity.name}.${member.name}`,
        })
      }
    }
    if (
      (declaration.identity.kind === 'interface' || declaration.identity.kind === 'class') &&
      (declaration.returns !== undefined || Boolean(declaration.overloads?.length))
    ) {
      obligations.push({
        id: `${prefix}.call-signature`,
        kind: 'member',
        pointer: declaration.pointer,
        label: `${declaration.identity.name}()`,
      })
    }
    for (const [index, overload] of (declaration.overloads ?? []).entries()) {
      obligations.push({
        id: `${prefix}.overload.${index}`,
        kind: 'overload',
        pointer: overload.pointer ?? declaration.pointer,
        label: `${declaration.identity.name} overload ${index + 1}`,
      })
    }
    for (const parameter of declaration.parameters ?? []) {
      obligations.push({
        id: `${prefix}.parameter.${parameter.index}.${parameter.name}`,
        kind: 'parameter',
        pointer: parameter.pointer,
        label: `${declaration.identity.name}(${parameter.name})`,
      })
    }
    if (declaration.returns !== undefined) {
      obligations.push({
        id: `${prefix}.return`,
        kind: 'return',
        pointer: `${declaration.pointer}/returns`,
        label: `${declaration.identity.name} return`,
      })
    }
    if (declaration.mode) {
      obligations.push({
        id: `${prefix}.mode`,
        kind: 'mode',
        pointer: `${declaration.pointer}/mode`,
        label: `${declaration.identity.name} mode`,
      })
    }
    for (const code of declaration.errors ?? []) {
      obligations.push({
        id: `${prefix}.error.${proofSegment(code)}`,
        kind: 'error-code',
        pointer: `${declaration.pointer}/throws`,
        label: `${declaration.identity.name} error ${code}`,
      })
    }
    for (const [category, heritage] of [
      ['extends', declaration.extends],
      ['implements', declaration.implements],
    ] as const) {
      for (const target of heritage ?? []) {
        obligations.push({
          id: `${prefix}.${category}.${proofType(target)}`,
          kind: 'heritage',
          pointer: target.pointer,
          label: `${declaration.identity.name} ${category} ${typeName(target)}`,
        })
      }
    }
  }
  for (const imported of imports) {
    obligations.push({
      id: `module.import.${imported.kind}.${proofIdentity(imported)}`,
      kind: 'import',
      pointer: apiPointer,
      label: `${imported.kind} ${imported.name}`,
    })
  }
  for (const item of packages) {
    obligations.push({
      id: `module.package.${item.name}`,
      kind: 'package',
      pointer: item.pointer,
      label: item.name,
    })
  }
  return obligations
}

function proofType(type: ExpectedType): string {
  const expression = type.expression
  if (expression.kind === 'declaration') return proofIdentity(expression.declaration)
  if (expression.kind === 'external') {
    return encodeURIComponent(`${expression.target}#${expression.name}`).replaceAll('.', '%2E')
  }
  return encodeURIComponent(JSON.stringify(expression)).replaceAll('.', '%2E')
}

function typeName(type: ExpectedType): string {
  const expression = type.expression
  return expression.kind === 'declaration'
    ? expression.declaration.name
    : expression.kind === 'external'
      ? expression.name
      : JSON.stringify(expression)
}

function proofIdentity(identity: DeclarationIdentity): string {
  return proofSegment(identity.key)
}

function proofSegment(value: string): string {
  return encodeURIComponent(value).replaceAll('.', '%2E')
}
