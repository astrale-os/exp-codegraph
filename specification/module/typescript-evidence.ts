import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { sourceRevision } from '../../source/file.ts'
import {
  operationSnapshot,
  operationSnapshotNamespace,
  readSourceRevision,
} from '../../source/operation-snapshot.ts'
import { isAuthoringSpecifier } from './authoring-syntax.ts'
import { visitModuleReferences } from './typescript-reference.ts'

interface TypeScriptDependencyEvidence {
  readonly file: string
  readonly revision: string
}

interface TypeScriptResolutionEvidence {
  readonly kind: 'module' | 'path' | 'type'
  readonly containingFile: string
  readonly specifier: string
  readonly mode: ts.ResolutionMode
  readonly resolvedFile?: string
}

export interface ModuleTypeScriptEvidence {
  readonly dependencies: readonly TypeScriptDependencyEvidence[]
  readonly resolutions: readonly TypeScriptResolutionEvidence[]
}

const resolutions = operationSnapshotNamespace<string | null>('module-resolutions')

export function captureModuleTypeScriptEvidence(
  program: ts.Program,
  options: ts.CompilerOptions,
  selectedSources: readonly ts.SourceFile[] = program.getSourceFiles(),
): ModuleTypeScriptEvidence {
  const sources = selectedSources
  return {
    dependencies: sources
      .map((source) => ({
        file: canonicalFile(source.fileName),
        revision: sourceRevision(source.text),
      }))
      .sort((left, right) => compare(left.file, right.file)),
    resolutions: observeResolutions(sources, options),
  }
}

export async function moduleTypeScriptEvidenceCurrent(
  evidence: ModuleTypeScriptEvidence,
  options: ts.CompilerOptions,
): Promise<boolean> {
  const batchSize = 64
  for (let index = 0; index < evidence.dependencies.length; index += batchSize) {
    const batch = evidence.dependencies.slice(index, index + batchSize)
    const revisions = await Promise.all(batch.map(({ file }) => readSourceRevision(file)))
    if (batch.some(({ revision }, offset) => revision !== revisions[offset])) return false
  }
  return evidence.resolutions.every((expected) => {
    const current = resolveObserved(expected, options)
    return current === expected.resolvedFile
  })
}

function observeResolutions(
  sources: readonly ts.SourceFile[],
  options: ts.CompilerOptions,
): TypeScriptResolutionEvidence[] {
  const values: TypeScriptResolutionEvidence[] = []
  for (const parsed of sources) {
    const file = canonicalFile(parsed.fileName)
    visitModuleReferences(parsed, (specifier, node, dynamic) => {
      if (dynamic) return
      const mode = ts.getModeForUsageLocation(parsed, node, options)
      values.push(resolutionEvidence('module', file, specifier, mode, options))
    })
    for (const reference of parsed.referencedFiles) {
      values.push(resolutionEvidence('path', file, reference.fileName, undefined, options))
    }
    for (const reference of parsed.typeReferenceDirectives) {
      values.push(
        resolutionEvidence('type', file, reference.fileName, reference.resolutionMode, options),
      )
    }
    // Compiler-owned lib directives resolve inside the immutable TypeScript installation. Their
    // loaded targets are already present in dependency evidence and content-validated above.
  }
  return values.sort(
    (left, right) =>
      compare(left.kind, right.kind) ||
      compare(left.containingFile, right.containingFile) ||
      compare(left.specifier, right.specifier) ||
      Number(left.mode ?? -1) - Number(right.mode ?? -1),
  )
}

function resolutionEvidence(
  kind: TypeScriptResolutionEvidence['kind'],
  containingFile: string,
  specifier: string,
  mode: ts.ResolutionMode,
  options: ts.CompilerOptions,
): TypeScriptResolutionEvidence {
  const identity = { kind, containingFile, specifier, mode }
  const resolvedFile = resolveObserved(identity, options)
  return { ...identity, ...(resolvedFile ? { resolvedFile } : {}) }
}

function resolveObserved(
  evidence: Omit<TypeScriptResolutionEvidence, 'resolvedFile'>,
  options: ts.CompilerOptions,
): string | undefined {
  const key = `${evidence.kind}\0${evidence.containingFile}\0${evidence.specifier}\0${evidence.mode ?? 'default'}`
  const snapshot = operationSnapshot(resolutions)
  if (snapshot?.has(key)) return snapshot.get(key) ?? undefined
  const result = resolveFresh(evidence, options)
  snapshot?.set(key, result ?? null)
  return result
}

function resolveFresh(
  evidence: Omit<TypeScriptResolutionEvidence, 'resolvedFile'>,
  options: ts.CompilerOptions,
): string | undefined {
  if (evidence.kind === 'path') {
    const target = resolve(dirname(evidence.containingFile), evidence.specifier)
    return ts.sys.fileExists(target) ? canonicalFile(target) : undefined
  }
  if (evidence.kind === 'type') {
    const target = ts.resolveTypeReferenceDirective(
      evidence.specifier,
      evidence.containingFile,
      options,
      ts.sys,
      undefined,
      undefined,
      evidence.mode,
    ).resolvedTypeReferenceDirective?.resolvedFileName
    return target ? canonicalFile(target) : undefined
  }
  const containingFile =
    isAuthoringSpecifier(evidence.specifier)
      ? fileURLToPath(import.meta.url)
      : evidence.containingFile
  const target = ts.resolveModuleName(
    evidence.specifier,
    containingFile,
    options,
    ts.sys,
    undefined,
    undefined,
    evidence.mode,
  ).resolvedModule?.resolvedFileName
  return target ? canonicalFile(target) : undefined
}

function canonicalFile(path: string): string {
  const absolute = resolve(path)
  return ts.sys.realpath ? ts.sys.realpath(absolute) : absolute
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
