import type {
  NormalizedDependency,
  ObservedDeclaration,
} from './model.ts'

import {
  canonicalExpected,
  declarationKindCompatible,
} from './context.ts'

import {
  isTestArtifact,
  declarationPrefix,
  packagePatternMatches,
  safeId,
} from './semantics.ts'

import { DeclarationEvaluator } from './declaration/evaluator.ts'

export class ModuleEvaluator extends DeclarationEvaluator {
  evaluate(): void {
    this.pass(`module.${this.expected.name}`)
    this.evaluateExports()
    this.evaluateErrorCodes()
    this.evaluateUnboundDeclarations()
    this.evaluateImports()
    this.evaluateDependencies()
    this.evaluatePackageBoundary()
    this.evaluateInverseClosure()
    for (const rule of this.rules) {
      if (this.evaluated.has(rule.id)) continue
      rule.status = 'error'
      rule.diagnostics = [
        {
          code: 'MODULE_OBLIGATION_UNEVALUATED',
          message: 'The built-in provider did not establish evidence for this obligation.',
          location: rule.diagnostics[0]?.location,
        },
      ]
    }
  }

  private evaluateExports(): void {
    const expectedPaths = new Set<string>()
    for (const item of this.expected.exports) {
      const path = item.path.join('.')
      expectedPaths.add(path)
      const id = `module.export.${path}.${item.declaration.kind}`
      const actual = this.observedExports.get(path)
      if (!actual) {
        this.fail(id, 'MODULE_EXPORT_MISSING', `Specified export is absent: ${path}`, item.pointer)
        continue
      }
      const declaration = this.context.observedDeclarations.get(actual.declaration)
      if (!declaration) {
        this.error(
          id,
          'MODULE_EXPORT_UNRESOLVED',
          `TypeScript export symbol could not be materialized: ${path}`,
          item.pointer,
          actual.location,
        )
        continue
      }
      const expectedDeclaration = this.context.expected.declarations.get(item.declaration.key)
      const projectedTypeFacet =
        declaration.kind === 'factory' && actual.typeOnly && !expectedDeclaration?.facets
      if (
        item.sourceModule &&
        (actual.sourceModule !== item.sourceModule || declaration.name !== item.declaration.name)
      ) {
        this.fail(
          id,
          'MODULE_DECLARATION_IDENTITY_MISMATCH',
          `External declaration identity differs for ${path}.`,
          item.pointer,
          actual.location,
          `${item.sourceModule}#${item.declaration.name}`,
          `${actual.sourceModule ?? '<local>'}#${declaration.name}`,
        )
        continue
      }
      if (item.sourceModule && expectedDeclaration?.conformance === 'identity') {
        if (item.typeOnly !== actual.typeOnly) {
          this.fail(
            id,
            'MODULE_EXPORT_TYPE_MODE_MISMATCH',
            `Export type/value mode differs for ${path}.`,
            item.pointer,
            actual.location,
            item.typeOnly ? 'type-only export' : 'runtime export',
            actual.typeOnly ? 'type-only export' : 'runtime export',
          )
          continue
        }
        this.pass(id)
        this.opaqueExternalExportPaths.add(path)
        this.bindDeclaration(item.declaration, declaration, id, 'identity')
        this.addInverse(
          `observed.export.${safeId(path)}.${actual.kind}`,
          'pass',
          `Observed export is declared: ${path}`,
          actual.location,
        )
        continue
      }
      if (
        declaration.kind === 'factory' &&
        !expectedDeclaration?.facets &&
        !expectedDeclaration?.factory &&
        !projectedTypeFacet
      ) {
        this.error(
          id,
          'MODULE_FACTORY_FACETS_UNSPECIFIED',
          `The code export ${path} has both type and runtime value facets, but api.d.ts does not declare both.`,
          item.pointer,
          actual.location,
        )
        continue
      }
      if (expectedDeclaration?.facets && declaration.kind !== 'factory') {
        this.fail(
          id,
          'MODULE_FACTORY_FACETS_MISSING',
          `Export ${path} must provide one type-alias facet and one runtime value facet.`,
          item.pointer,
          actual.location,
          'type alias + runtime value',
          declaration.kind,
        )
        continue
      }
      if (expectedDeclaration?.factory && declaration.kind !== 'factory') {
        this.fail(
          id,
          'MODULE_FACTORY_FACETS_MISSING',
          `Export ${path} must provide both type and runtime value facets.`,
          item.pointer,
          actual.location,
          'type + runtime value',
          declaration.kind,
        )
        continue
      }
      if (item.typeOnly !== actual.typeOnly) {
        this.fail(
          id,
          'MODULE_EXPORT_TYPE_MODE_MISMATCH',
          `Export type/value mode differs for ${path}.`,
          item.pointer,
          actual.location,
          item.typeOnly ? 'type-only export' : 'runtime export',
          actual.typeOnly ? 'type-only export' : 'runtime export',
        )
        continue
      }
      if (
        !(projectedTypeFacet && item.declaration.kind === 'value') &&
        !declarationKindCompatible(item.declaration.kind, declaration, expectedDeclaration)
      ) {
        this.fail(
          id,
          'MODULE_EXPORT_KIND_MISMATCH',
          `Export kind differs for ${path}.`,
          item.pointer,
          actual.location,
          item.declaration.kind,
          actual.kind,
        )
        continue
      }
      if (
        !item.typeOnly &&
        (actual.kind === 'class' || (actual.kind === 'factory' && expectedDeclaration?.facets)) &&
        actual.typeOnly
      ) {
        this.fail(
          id,
          'MODULE_RUNTIME_EXPORT_MISSING',
          `Class export is type-only: ${path}`,
          item.pointer,
          actual.location,
          'runtime class',
          'type-only export',
        )
        continue
      }
      this.pass(id)
      this.bindDeclaration(item.declaration, declaration, id, projectedTypeFacet ? 'type' : 'full')
      this.addInverse(
        `observed.export.${safeId(path)}.${actual.kind}`,
        'pass',
        `Observed export is declared: ${path}`,
        actual.location,
      )
    }
    for (const actual of this.observed.exports) {
      const path = actual.path.join('.')
      if (expectedPaths.has(path)) continue
      if ([...this.opaqueExternalExportPaths].some((prefix) => path.startsWith(`${prefix}.`))) {
        continue
      }
      this.addInverse(
        `observed.export.${safeId(path)}.${actual.kind}`,
        'fail',
        `Public export is not declared by the module specification: ${path}`,
        actual.location,
        'MODULE_EXPORT_UNDECLARED',
      )
    }
  }

  private evaluateUnboundDeclarations(): void {
    for (const declaration of this.expected.declarations) {
      const id = declarationPrefix(declaration)
      if (this.evaluated.has(id)) continue
      this.fail(
        id,
        'MODULE_DECLARATION_MISSING',
        `Specified declaration is not reachable through the public code surface: ${declaration.identity.name}`,
        declaration.pointer,
      )
      this.failDeclarationChildren(declaration, undefined, 'Containing declaration is absent.')
    }
  }

  private evaluateErrorCodes(): void {
    const observed = new Set(this.observed.errorCodes.map((item) => item.code))
    for (const declaration of this.expected.declarations) {
      for (const code of declaration.errors ?? []) {
        const id = `${declarationPrefix(declaration)}.error.${safeId(code)}`
        if (observed.has(code)) {
          this.pass(id)
          continue
        }
        this.fail(
          id,
          'ERROR_CODE_MISSING',
          `Error code ${code} has no TypeScript declaration.`,
          `${declaration.pointer}/throws`,
          undefined,
          code,
          null,
        )
      }
    }
  }

  private evaluateInverseClosure(): void {
    for (const declaration of this.observed.declarations) {
      if (this.context.observedDeclarationOwners.get(declaration.identity) !== this.observed.id) {
        continue
      }
      const id = `observed.declaration.${safeId(declaration.identity)}`
      if (this.boundObserved.has(declaration.identity)) {
        this.addInverse(
          id,
          'pass',
          `Publicly reachable type is declared: ${declaration.name}`,
          declaration.location,
        )
      } else {
        this.evaluateUnsupportedValueShape(declaration)
        this.addInverse(
          id,
          'fail',
          `Publicly reachable declaration is not represented in the specification: ${declaration.name}`,
          declaration.location,
          'MODULE_PUBLIC_TYPE_UNDECLARED',
        )
      }
    }
  }

  private evaluateUnsupportedValueShape(declaration: ObservedDeclaration): void {
    if (declaration.kind !== 'value') return
    for (const [label, count] of [['index', declaration.indexSignatureCount ?? 0]] as const) {
      if (count === 0) continue
      this.addInverse(
        `observed.shape.${safeId(declaration.identity)}.${label}`,
        'error',
        `Public ${label} signatures are outside the supported TypeSpec declaration surface.`,
        declaration.location,
        `TYPESCRIPT_${label.toUpperCase()}_SIGNATURE_UNSUPPORTED`,
      )
    }
  }

  private evaluateImports(): void {
    const imported = new Set(
      this.expected.imports.map((identity) =>
        canonicalExpected(identity.key, this.context.expected),
      ),
    )
    for (const identity of this.expected.imports) {
      const id = `module.import.${identity.kind}.${safeId(identity.key)}`
      const canonical = canonicalExpected(identity.key, this.context.expected)
      if (this.usedExpected.has(canonical)) this.pass(id)
      else
        this.fail(
          id,
          'MODULE_CONTRACT_IMPORT_STALE',
          `Referenced API declaration is not used by the observed public surface: ${identity.name}`,
          '/api',
        )
    }
    for (const canonical of this.usedExpected) {
      const declaration = this.context.expected.declarations.get(canonical)
      if (
        !declaration ||
        declaration.identity.source === this.expected.id ||
        imported.has(canonical)
      )
        continue
      const observedIdentity = this.bindings.get(canonical)
      const observed = observedIdentity
        ? this.context.observedDeclarations.get(observedIdentity)
        : undefined
      this.addInverse(
        `observed.import.${safeId(canonical)}`,
        'fail',
        `Public declaration dependency is absent from the authoritative API references: ${declaration.identity.name}`,
        observed?.location,
        'MODULE_CONTRACT_IMPORT_UNDECLARED',
      )
    }
  }

  private evaluateDependencies(): void {
    const expected = new Set(this.expected.packages.map((item) => item.name))
    const expectedPatterns = this.expected.packagePatterns.map((item) => item.pattern)
    for (const item of this.expected.packages) {
      const id = `module.package.${item.name}`
      const observed = this.observed.dependencies.some(
        (edge) => edge.targetModule === `package:${item.name}`,
      )
      const installed = this.observed.declaredPackages.includes(item.name)
      if (!installed) {
        this.fail(
          id,
          'MODULE_PACKAGE_NOT_DECLARED',
          `Allowlisted package is absent from the code package.json: ${item.name}`,
          item.pointer,
        )
      } else if (item.requireObserved !== false && !observed) {
        this.fail(
          id,
          'MODULE_PACKAGE_STALE',
          `Allowlisted package has no observed code or public-API dependency: ${item.name}`,
          item.pointer,
        )
      } else {
        this.pass(id)
      }
    }
    const knownModules = new Set(this.context.observation.knownModuleIds)
    for (const edge of this.observed.dependencies) {
      const packageName = edge.targetModule.startsWith('package:')
        ? edge.targetModule.slice('package:'.length)
        : undefined
      const platform = edge.targetModule.startsWith('platform:')
      const declaredPackage = packageName
        ? expected.has(packageName) ||
          expectedPatterns.some((pattern) => packagePatternMatches(pattern, packageName))
        : false
      const declaredWorkspacePackage = Boolean(
        packageName &&
        this.observed.workspacePackages.includes(packageName) &&
        this.observed.declaredPackages.includes(packageName),
      )
      const publicModule = knownModules.has(edge.targetModule)
      const occurrenceResults = edge.occurrences.map((occurrence) => {
        const declaredTestPackage = Boolean(
          packageName &&
          isTestArtifact(edge.sourceFile) &&
          this.observed.developmentPackages.includes(packageName),
        )
        const declaredByPublicProvider = Boolean(
          packageName && this.publicPackageProviderDeclares(occurrence, packageName),
        )
        return {
          occurrence,
          permitted:
            !occurrence.deep &&
            (platform ||
              declaredPackage ||
              declaredWorkspacePackage ||
              declaredTestPackage ||
              declaredByPublicProvider ||
              publicModule),
          declaredByPublicProvider,
          declaredTestPackage,
        }
      })
      const rejected = occurrenceResults.find((item) => !item.permitted)
      const representative = rejected?.occurrence ?? edge.occurrences[0]!
      const permitted = rejected === undefined
      const code = representative.deep
        ? 'MODULE_DEEP_IMPORT'
        : packageName &&
            !declaredPackage &&
            !declaredWorkspacePackage &&
            !rejected?.declaredTestPackage &&
            !rejected?.declaredByPublicProvider
          ? 'MODULE_PACKAGE_UNDECLARED'
          : publicModule || platform
            ? undefined
            : 'MODULE_DEPENDENCY_UNOWNED'
      this.addInverse(
        `observed.dependency.${safeId(edge.id)}`,
        permitted ? 'pass' : 'fail',
        representative.deep
          ? `Cross-module import bypasses the target entrypoint: ${representative.specifier}`
          : permitted
            ? `Observed dependency is grounded: ${edge.targetModule} (${edge.kind})`
            : packageName
              ? `External package is not allowlisted: ${packageName}`
              : `Dependency does not resolve to a declared module, platform, or package: ${edge.targetModule}`,
        representative.location,
        code,
      )
    }
    const declaredSources = new Set(this.context.observation.modules.map((module) => module.id))
    for (const edge of this.observed.inboundDependencies) {
      const deep = edge.occurrences.find((occurrence) => occurrence.deep)
      if (!deep || declaredSources.has(edge.sourceModule)) continue
      this.addInverse(
        `observed.dependency.inbound.${safeId(edge.id)}`,
        'fail',
        `An unowned consumer bypasses the module entrypoint: ${deep.specifier}`,
        deep.location,
        'MODULE_DEEP_IMPORT',
      )
    }
  }

  private publicPackageProviderDeclares(
    occurrence: NormalizedDependency['occurrences'][number],
    packageName: string,
  ): boolean {
    const path = occurrence.publicPath
    if (!path?.length || occurrence.specifier !== '<public-type-closure>') return false
    for (let index = path.length - 2; index >= 0; index--) {
      const owner = this.context.observedDeclarationOwners.get(path[index]!)
      if (!owner) continue
      return Boolean(
        this.context.observedModules.get(owner)?.declaredPackages.includes(packageName),
      )
    }
    return false
  }

  private evaluatePackageBoundary(): void {
    // Package export-map ownership is a separate repository capability. Module facts prove
    // semantic dependency boundaries without fabricating evidence for an unavailable inventory.
  }

}
