import { statSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

import { operationSourceText } from '../source/operation-snapshot.ts'
import { workspacePackageCoordinate } from '../typescript/package-coordinate.ts'
import { typeScriptSourceHasAmbientEffects } from '../typescript/compiler-universe.optimization.ts'
import {
  collectExternalReferences,
  type ExternalReference,
  isExternalSpecifier,
} from './external.ts'

export interface DeclarationEntry {
  readonly files: ReadonlySet<string>
  readonly externalReferences: readonly ExternalReference[]
  readonly ambientEffects: boolean
}

export interface DeclarationSourceEvidence {
  readonly bytes: number
  readonly externalReferences: readonly ExternalReference[]
  readonly ambientEffects: boolean
  readonly dependencies: readonly string[]
}

const MAX_API_SOURCES = 192
const MAX_API_SOURCE_BYTES = 8 * 1024 * 1024

/** Immutable operation-owned declaration source corpus shared by every entrypoint traversal. */
export function createDeclarationSourceCorpus(
  projectRoot: string,
  options: ts.CompilerOptions,
  host: ts.CompilerHost,
): {
  discover(mainFile: string): DeclarationEntry
  evidence(file: string): DeclarationSourceEvidence
} {
  const sources = new Map<string, DeclarationSourceEvidence>()

  return {
    discover(mainFile) {
      const externalReferences: ExternalReference[] = []
      const pending = [mainFile]
      const seen = new Set<string>()
      let sourceBytes = 0
      let ambientEffects = false
      while (pending.length) {
        const file = resolve(pending.pop()!)
        if (seen.has(file)) continue
        if (seen.size >= MAX_API_SOURCES) {
          throw new Error(`API exceeds ${MAX_API_SOURCES} declaration sources.`)
        }
        seen.add(file)
        const source = admittedSource(file)
        if (sourceBytes + source.bytes > MAX_API_SOURCE_BYTES) {
          throw new Error(`API sources exceed ${MAX_API_SOURCE_BYTES} bytes.`)
        }
        sourceBytes += source.bytes
        ambientEffects ||= source.ambientEffects
        externalReferences.push(...source.externalReferences)
        pending.push(...source.dependencies)
      }
      return { files: seen, externalReferences, ambientEffects }
    },
    evidence(file) {
      return admittedSource(resolve(file))
    },
  }

  function admittedSource(file: string): DeclarationSourceEvidence {
    const existing = sources.get(file)
    if (existing) return existing
    const admitted = operationSourceText(file)
    const bytes = admitted?.bytes ?? statSync(file).size
    const parsed = host.getSourceFile(
      file,
      options.target ?? ts.ScriptTarget.ES2022,
    )
    if (!parsed) {
      const unavailable = { bytes, externalReferences: [], ambientEffects: false, dependencies: [] }
      sources.set(file, unavailable)
      return unavailable
    }
    if (parsed.typeReferenceDirectives.length) {
      throw new Error(
        'External type-reference directives are unsupported in API declarations; use an explicit type-only import.',
      )
    }
    const dependencies: string[] = []
    for (const reference of parsed.referencedFiles) {
      const target = declarationRealpathSafe(resolve(dirname(file), reference.fileName))
      if (!target || !permittedDeclarationPath(projectRoot, target)) {
        throw new Error(
          `API declaration path reference must target a .spec declaration: ${reference.fileName}`,
        )
      }
      dependencies.push(target)
    }
    for (const statement of parsed.statements) {
      const specifier =
        ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : ts.isExportDeclaration(statement) &&
              statement.moduleSpecifier &&
              ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : undefined
      if (!specifier || isExternalSpecifier(specifier)) continue
      const resolved = ts.resolveModuleName(specifier, file, options, host).resolvedModule
      if (!resolved?.resolvedFileName.endsWith('.d.ts')) continue
      const canonical = declarationRealpathSafe(resolved.resolvedFileName)
      if (canonical && permittedDeclarationPath(projectRoot, canonical)) dependencies.push(canonical)
    }
    const source = {
      bytes,
      externalReferences: collectExternalReferences(parsed),
      ambientEffects: typeScriptSourceHasAmbientEffects(parsed),
      dependencies,
    }
    sources.set(file, source)
    return source
  }
}

export function permittedDeclarationPath(projectRoot: string, file: string): boolean {
  if (!file.endsWith('.d.ts') || file.includes(`${sep}node_modules${sep}`)) return false
  if (declarationPathInside(projectRoot, file)) return true
  return Boolean(
    file.includes(`${sep}.spec${sep}`) && workspacePackageCoordinate(projectRoot, file),
  )
}

export function declarationRealpathSafe(file: string): string | undefined {
  try {
    return realpathSync(resolve(file))
  } catch {
    return undefined
  }
}

export function declarationPathInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}
