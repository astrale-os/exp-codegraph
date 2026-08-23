import type { ApiDiagnostic, ApiModel, ApiModelV2 } from '../api/model.ts'
import type { ApiCompiler } from '../compiler/contract.ts'
import type { Diagnostic } from '../source/diagnostic.ts'
import type { DeclarationResource } from './resource/index.ts'
import type { DeclarationSurfaceSemantics } from '../typescript/surface/semantics.ts'
import type { SpecificationSnapshot } from './snapshot/model.ts'

import { specificationApiCompiler } from '../compiler/default.ts'
import { sourceRevision } from '../source/file.ts'
import {
  operationSnapshot,
  operationSnapshotNamespace,
  readOperationSourceText,
  readSourceRevision,
} from '../source/operation-snapshot.ts'
import { locateResource } from '../source/resource.ts'

const restoredDeclarations = operationSnapshotNamespace<DeclarationResourceLoad<ApiModelV2>>(
  'restored-specification-declarations',
)
const declarationNavigation = operationSnapshotNamespace<boolean>(
  'specification-declaration-navigation',
)
const declarationModels = operationSnapshotNamespace<boolean>(
  'specification-declaration-models',
)

/** Select presentation-only declaration navigation for one coherent specification operation. */
export function configureSpecificationDeclarationNavigation(include: boolean): void {
  operationSnapshot(declarationNavigation)?.set('include', include)
}

/** Select complete normalized declaration models for one coherent specification operation. */
export function configureSpecificationDeclarationModels(include: boolean): void {
  operationSnapshot(declarationModels)?.set('include', include)
}

export interface DeclarationResourceLoad<Model extends ApiModel = ApiModelV2> {
  readonly resource?: DeclarationResource<Model>
  readonly diagnostics: readonly Diagnostic[]
}

export function createDeclarationResourceLoader<Model extends ApiModel>(
  compiler: ApiCompiler,
  semantics: DeclarationSurfaceSemantics,
  version: Model['version'],
) {
  return async function loadDeclarationResource(
    root: string,
    containingFile: string,
    ownerSource: string,
    reference: string,
    pointer: string,
  ): Promise<DeclarationResourceLoad<Model>> {
    const diagnostics: Diagnostic[] = []
    try {
      const located = await locateResource(root, containingFile, reference, '.d.ts')
      const restored = operationSnapshot(restoredDeclarations)?.get(
        declarationKey(located.source, pointer, version),
      )
      if (restored && (await readSourceRevision(located.absolute)) === restored.resource?.revision) {
        return restored as DeclarationResourceLoad<Model>
      }
      const compilationRequest = compiler.compile({
        mainFile: located.absolute,
        projectRoot: root,
        semantics,
        declarationNavigation: specificationDeclarationNavigation(),
        declarationModel: specificationDeclarationModels(),
      })
      const [text, compilation] = await Promise.all([
        readOperationSourceText(located.absolute),
        compilationRequest,
      ])
      const revision = sourceRevision(text)
      diagnostics.push(
        ...compilation.diagnostics
          .filter((diagnostic) => diagnostic.severity === 'error')
          .map((diagnostic) =>
            declarationDiagnostic(ownerSource, located.source, pointer, diagnostic),
          ),
      )
      if (compilation.ok && compilation.api && compilation.api.version !== version) {
        diagnostics.push({
          code: 'DECLARATION_COMPILER_SEMANTICS_MISMATCH',
          message: `Declaration compiler returned API model V${compilation.api.version}; V${version} was required.`,
          file: located.source,
          line: 1,
          column: 1,
          pointer,
        })
      }
      const model =
        compilation.ok && compilation.api?.version === version
          ? (compilation.api as Model)
          : undefined
      return {
        resource: {
          ref: reference,
          source: located.source,
          text,
          revision,
          ...(model ? { model } : {}),
        },
        diagnostics,
      }
    } catch (error) {
      return {
        diagnostics: [
          {
            code: 'DECLARATION_RESOURCE_INVALID',
            message: error instanceof Error ? error.message : String(error),
            file: ownerSource,
            line: 1,
            column: 1,
            pointer,
          },
        ],
      }
    }
  }
}

/** Restore declaration results only when the exact inventory delta cannot affect declaration input. */
export function seedSpecificationDeclarationResources(
  specifications: readonly SpecificationSnapshot[],
  changed: readonly string[],
): ReadonlySet<string> {
  const cache = operationSnapshot(restoredDeclarations)
  const seeded = new Set<string>()
  if (!cache || changed.some((path) => path.endsWith('.d.ts') || path.endsWith('.json'))) return seeded
  for (const specification of specifications) {
    const resources = [
      ['/api', specification.module.api],
      ['/internal', specification.module.internal],
      ...specification.module.ports.map((resource) => [resource.declarationPointer, resource] as const),
    ] as const
    for (const [pointer, resource] of resources) {
      if (!resource) continue
      cache.set(declarationKey(resource.source, pointer, 2), {
        resource,
        diagnostics: specification.diagnostics.filter(
          (diagnostic) =>
            diagnostic.pointer === pointer &&
            (diagnostic.code.startsWith('API_') || diagnostic.code === 'DECLARATION_RESOURCE_INVALID'),
        ),
      })
      seeded.add(resource.source)
    }
  }
  return seeded
}

function declarationKey(file: string, pointer: string, version: number): string {
  return `${file}\0${pointer}\0${version}`
}

function specificationDeclarationNavigation(): boolean {
  return operationSnapshot(declarationNavigation)?.get('include') ?? true
}

function specificationDeclarationModels(): boolean {
  return operationSnapshot(declarationModels)?.get('include') ?? true
}

export const loadDeclarationResource = createDeclarationResourceLoader<ApiModelV2>(
  specificationApiCompiler,
  'specification-v2',
  2,
)

/** V2 authored declaration compiler used only by immutable specification snapshots. */
export const loadSpecificationDeclarationResource =
  loadDeclarationResource

function declarationDiagnostic(
  ownerSource: string,
  resourceSource: string,
  pointer: string,
  diagnostic: ApiDiagnostic,
): Diagnostic {
  return {
    code: stableCode(diagnostic),
    message: diagnostic.message,
    file: diagnostic.range?.file ?? resourceSource ?? ownerSource,
    line: diagnostic.range?.start.line ?? 1,
    column: diagnostic.range?.start.column ?? 1,
    pointer,
  }
}

function stableCode(diagnostic: ApiDiagnostic): string {
  const source = diagnostic.source.replaceAll(/[^A-Za-z0-9]+/g, '_').toUpperCase()
  const code = diagnostic.code.replaceAll(/[^A-Za-z0-9]+/g, '_').toUpperCase()
  return `API_${source}_${code}`
}
