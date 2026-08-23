import { sep } from 'node:path'

import type { Diagnostic } from '../../source/diagnostic.ts'
import { sourceRevision } from '../../source/file.ts'
import { readOperationSourceText } from '../../source/operation-snapshot.ts'
import { loadSchema } from '../../schema/load.ts'
import { loadSpecificationDeclarationResource } from '../declaration.ts'
import type {
  BenchmarkResource,
  CapabilityResource,
  CodeDeclarationResource,
  ExampleResource,
  LawResource,
  ModuleCodeResource,
  PackagePatternResource,
  PackageSpecificationResource,
  SchemaResource,
  StateResource,
} from '../resource/index.ts'
import { resolvePort } from '../port.ts'
import { compileCode } from '../module/code.ts'
import { compileDescriptor, type DescriptorKind } from '../module/descriptor.ts'
import type { ModuleFile } from '../module/inventory.ts'
import { compileLayout } from '../module/layout.ts'
import {
  compilePackageDefinition,
  compilePackagePatterns,
  packageNameFromPath,
} from '../module/package.ts'
import type {
  AuthoredLayoutResource,
  SpecificationDeclarationResource,
  SpecificationPortResource,
} from './model.ts'

export interface Resources<Resource> {
  readonly resources: readonly Resource[]
  readonly diagnostics: readonly Diagnostic[]
}

export async function loadCodeDeclaration(
  file: ModuleFile,
): Promise<{ resource?: CodeDeclarationResource; diagnostics: Diagnostic[] }> {
  try {
    const text = await readOperationSourceText(file.absolute)
    const compiled = compileCode(file.source, text)
    return {
      ...(compiled.configuration
        ? {
            resource: {
              ref: './code.ts',
              source: file.source,
              text,
              revision: sourceRevision(text),
              internals: compiled.configuration.internals,
            },
          }
        : {}),
      diagnostics: [...compiled.diagnostics],
    }
  } catch (error) {
    return { diagnostics: [fileDiagnostic('CODE_DECLARATION_INVALID', error, file)] }
  }
}

export function normativeResourceRevision(
  resource: { readonly revision: string } | SpecificationDeclarationResource,
): string {
  if (!('model' in resource) || !resource.model) return resource.revision
  return sourceRevision(
    `${resource.revision}\0${resource.model.sourceRevision}\0${resource.model.fingerprint}`,
  )
}

export async function loadSchemas(
  root: string,
  files: readonly ModuleFile[],
): Promise<Resources<SchemaResource>> {
  return compact(
    await Promise.all(
      files.map(async (file) => {
        try {
          const schema = await loadSchema(file.absolute, file.source, root, [], { compile: false })
          return {
            resource: {
              ref: `./${file.relative}`,
              source: file.source,
              text: schema.text,
              revision: sourceRevision(schema.text),
              schema: schema.schema,
            },
            diagnostics: schema.diagnostics,
          }
        } catch (error) {
          return { diagnostics: [fileDiagnostic('SCHEMA_RESOURCE_INVALID', error, file)] }
        }
      }),
    ),
  )
}

export async function loadPorts(
  root: string,
  apiFile: string,
  specSource: string,
  files: readonly ModuleFile[],
): Promise<Resources<SpecificationPortResource>> {
  return compact(
    await Promise.all(
      files.map(async (file) => {
        const pointer = `/${file.relative}`
        const declaration = await loadSpecificationDeclarationResource(
          root,
          apiFile,
          specSource,
          `./${file.relative}`,
          pointer,
        )
        const diagnostics = [...declaration.diagnostics]
        if (!declaration.resource) return { diagnostics }
        const resolved = resolvePort(declaration.resource, pointer, portNamespace(file.relative))
        diagnostics.push(...resolved.diagnostics)
        return { ...(resolved.port ? { resource: resolved.port } : {}), diagnostics }
      }),
    ),
  )
}

export type DescriptorResource<Kind extends DescriptorKind> = Kind extends 'capability'
  ? CapabilityResource
  : Kind extends 'law'
    ? LawResource
    : Kind extends 'state'
      ? StateResource
      : BenchmarkResource

export async function loadDescriptors<Kind extends DescriptorKind>(
  kind: Kind,
  files: readonly ModuleFile[],
): Promise<Resources<DescriptorResource<Kind>>> {
  return compact(
    await Promise.all(
      files.map(async (file) => {
        try {
          const text = await readOperationSourceText(file.absolute)
          const compiled = compileDescriptor(kind, file.source, text)
          return {
            resource: {
              ref: `./${file.relative}`,
              source: file.source,
              text,
              revision: sourceRevision(text),
              kind,
              definitions: compiled.definitions,
            } as DescriptorResource<Kind>,
            diagnostics: [...compiled.diagnostics],
          }
        } catch (error) {
          return { diagnostics: [fileDiagnostic('MODULE_DESCRIPTOR_INVALID', error, file)] }
        }
      }),
    ),
  )
}

export async function loadCodeResources(
  kind: 'flow',
  files: readonly ModuleFile[],
): Promise<Resources<ModuleCodeResource>> {
  return compact(await Promise.all(files.map((file) => loadCodeResource(kind, file))))
}

export async function loadCodeResource(
  kind: 'flow' | 'limits',
  file: ModuleFile,
): Promise<{ resource?: ModuleCodeResource; diagnostics: Diagnostic[] }> {
  try {
    const text = await readOperationSourceText(file.absolute)
    return {
      resource: {
        ref: `./${file.relative}`,
        source: file.source,
        text,
        revision: sourceRevision(text),
        kind,
      },
      diagnostics: [],
    }
  } catch (error) {
    return { diagnostics: [fileDiagnostic('MODULE_SOURCE_INVALID', error, file)] }
  }
}

export async function loadAuthoredLayout(
  file: ModuleFile,
): Promise<{ readonly resource?: AuthoredLayoutResource; readonly diagnostics: readonly Diagnostic[] }> {
  try {
    const text = await readOperationSourceText(file.absolute)
    const compiled = compileLayout(file.source, text)
    return {
      resource: {
        ref: './layout.ts',
        source: file.source,
        text,
        revision: sourceRevision(text),
        entries: compiled.entries.map(({ path, kind }) => ({ path, kind })),
        exact: compiled.exact,
        ignore: compiled.ignore,
      },
      diagnostics: compiled.diagnostics,
    }
  } catch (error) {
    return { diagnostics: [fileDiagnostic('LAYOUT_INVALID', error, file)] }
  }
}

export async function loadExamples(
  files: readonly ModuleFile[],
): Promise<Resources<ExampleResource>> {
  return compact(
    await Promise.all(
      files.map(async (file) => {
        try {
          const text = await readOperationSourceText(file.absolute)
          return {
            resource: {
              ref: `./${file.relative}`,
              source: file.source,
              text,
              revision: sourceRevision(text),
              against: 'api' as const,
              declarationPointer: `/${file.relative}`,
            },
            diagnostics: [],
          }
        } catch (error) {
          return { diagnostics: [fileDiagnostic('EXAMPLE_INVALID', error, file)] }
        }
      }),
    ),
  )
}

export async function loadPackages(
  files: readonly ModuleFile[],
): Promise<Resources<PackageSpecificationResource>> {
  return compact(
    await Promise.all(
      files.map(async (file) => {
        try {
          const text = await readOperationSourceText(file.absolute)
          const compiled = compilePackageDefinition(file.source, text)
          const diagnostics = [...compiled.diagnostics]
          const pathName = packageNameFromPath(file.relative)
          if (!pathName) {
            diagnostics.push({
              code: 'PACKAGE_PATH_INVALID',
              message: 'Package file paths must encode a valid package name.',
              file: file.source,
              line: 1,
              column: 1,
            })
          } else if (compiled.definition && pathName !== compiled.definition.package) {
            diagnostics.push({
              code: 'PACKAGE_PATH_MISMATCH',
              message: `Package file path declares ${pathName}, but its definition declares ${compiled.definition.package}.`,
              file: file.source,
              line: 1,
              column: 1,
            })
          }
          return {
            ...(compiled.definition
              ? {
                  resource: {
                    ref: `./${file.relative}`,
                    source: file.source,
                    text,
                    revision: sourceRevision(text),
                    ...compiled.definition,
                  },
                }
              : {}),
            diagnostics,
          }
        } catch (error) {
          return { diagnostics: [fileDiagnostic('PACKAGE_DEFINITION_INVALID', error, file)] }
        }
      }),
    ),
  )
}

export async function loadPackagePatterns(
  file: ModuleFile,
): Promise<Resources<PackagePatternResource>> {
  try {
    const text = await readOperationSourceText(file.absolute)
    const compiled = compilePackagePatterns(file.source, text)
    return {
      resources: compiled.definitions.map((definition, index) => ({
        ref: `./${file.relative}#${index}`,
        source: file.source,
        text,
        revision: sourceRevision(text),
        ...definition,
      })),
      diagnostics: compiled.diagnostics,
    }
  } catch (error) {
    return { resources: [], diagnostics: [fileDiagnostic('PACKAGE_PATTERNS_INVALID', error, file)] }
  }
}

export function revisionOf(resources: readonly (readonly [string, string])[]): string {
  return sourceRevision(
    resources
      .map(([source, revision]) => `${source}\0${revision}`)
      .sort(compare)
      .join('\0'),
  )
}

export function deduplicateDiagnostics(values: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = JSON.stringify([
      value.code,
      value.message,
      value.file,
      value.line,
      value.column,
      value.pointer,
    ])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function fileDiagnostic(code: string, error: unknown, file: ModuleFile): Diagnostic {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    file: file.source,
    line: 1,
    column: 1,
  }
}

export function moduleTitle(source: string, fallback: string): string {
  if (source === '.') return fallback || 'module'
  return source.split('/').filter(Boolean).join('.')
}

export function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compact<Resource>(
  loaded: readonly { readonly resource?: Resource; readonly diagnostics: readonly Diagnostic[] }[],
): { resources: Resource[]; diagnostics: Diagnostic[] } {
  return {
    resources: loaded.flatMap((entry) => (entry.resource ? [entry.resource] : [])),
    diagnostics: loaded.flatMap((entry) => entry.diagnostics),
  }
}

function portNamespace(relativePath: string): string | undefined {
  const segments = relativePath.split('/').slice(1, -1)
  return segments.length ? segments.join('.') : undefined
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
