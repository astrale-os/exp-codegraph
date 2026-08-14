import type { ApiDiagnostic, ApiModel, ApiModelV2 } from '../api/model.ts'
import type { ApiCompiler } from '../compiler/contract.ts'
import type { Diagnostic } from '../source/diagnostic.ts'
import type { DeclarationResource } from './resource/index.ts'
import type { DeclarationSurfaceSemantics } from '../typescript/surface/semantics.ts'

import { specificationApiCompiler } from '../compiler/default.ts'
import { readBounded, sourceRevision } from '../source/file.ts'
import { locateResource } from '../source/resource.ts'

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
      const compilationRequest = compiler.compile({
        mainFile: located.absolute,
        projectRoot: root,
        semantics,
      })
      const [text, compilation] = await Promise.all([
        readBounded(located.absolute),
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
