import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { FactTransaction } from '../../../analysis/index.ts'
import {
  TYPESCRIPT_MODULE_FACT_NAMESPACE,
  type TypeScriptModuleFact,
} from '../../../analysis/typescript/index.ts'

export interface ObservationProject {
  readonly project: string
  readonly modules: number
  readonly generation: string
}

/** Qualification transport only; this is not an analysis-engine persistence format. */
export interface ObservationCheckpoint {
  readonly format: 'astrale.typespec.v2.module-observations'
  readonly version: 1 | 2 | 3 | 4
  readonly boundaries: string
  readonly nativeDigest?: string
  readonly complete?: boolean
  readonly modules?: readonly [string, TypeScriptModuleFact][]
  readonly moduleIds?: readonly string[]
  readonly modulesDigest?: string
  readonly projects: readonly ObservationProject[]
  readonly transactions?: readonly [string, FactTransaction][]
}

export interface CompleteObservationCheckpoint extends ObservationCheckpoint {
  readonly version: 4
  readonly nativeDigest: string
  readonly complete: true
  readonly moduleIds: readonly string[]
  readonly modulesDigest: string
  readonly transactions: readonly [string, FactTransaction][]
}

export async function readObservationCheckpoint(
  path: string,
  boundaries: string,
  nativeDigest?: string,
): Promise<
  ObservationCheckpoint & { readonly modules: readonly [string, TypeScriptModuleFact][] }
> {
  const checkpoint = JSON.parse(await readFile(resolve(path), 'utf8')) as ObservationCheckpoint
  if (
    checkpoint.format !== 'astrale.typespec.v2.module-observations' ||
    ![1, 2, 3, 4].includes(checkpoint.version) ||
    checkpoint.boundaries !== boundaries ||
    !Array.isArray(checkpoint.projects)
  ) {
    throw new Error('Module-observation checkpoint does not match the current explicit boundaries.')
  }
  if (nativeDigest && (checkpoint.version < 2 || checkpoint.nativeDigest !== nativeDigest)) {
    throw new Error('Resumed module observations were produced by a different native binary.')
  }
  if (checkpoint.version < 4) {
    if (!Array.isArray(checkpoint.modules)) {
      throw new Error('Legacy module-observation checkpoint has no module payloads.')
    }
    return { ...checkpoint, modules: checkpoint.modules }
  }
  if (!Array.isArray(checkpoint.transactions)) {
    throw new Error('V4 module-observation checkpoint has no authoritative transactions.')
  }
  const modules = modulesFromTransactions(new Map(checkpoint.transactions))
  validateCheckpointModules(checkpoint, modules)
  return { ...checkpoint, modules: [...modules] }
}

export async function writeObservationCheckpoint(
  path: string,
  input: {
    readonly boundaries: string
    readonly nativeDigest: string
    readonly complete: boolean
    readonly observed: ReadonlyMap<string, TypeScriptModuleFact>
    readonly projects: readonly ObservationProject[]
    readonly transactions: ReadonlyMap<string, FactTransaction>
  },
): Promise<void> {
  const target = resolve(path)
  const temporary = `${target}.${process.pid}.tmp`
  const checkpoint: ObservationCheckpoint = {
    format: 'astrale.typespec.v2.module-observations',
    version: 4,
    boundaries: input.boundaries,
    nativeDigest: input.nativeDigest,
    complete: input.complete,
    moduleIds: [...input.observed.keys()].sort(compare),
    modulesDigest: digestModuleMap(input.observed),
    projects: [...input.projects].sort((left, right) => compare(left.project, right.project)),
    transactions: [...input.transactions].sort(([left], [right]) => compare(left, right)),
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, 'utf8')
  await rename(temporary, target)
}

export function validateCompleteObservationCheckpoint(
  value: ObservationCheckpoint,
): asserts value is CompleteObservationCheckpoint {
  if (
    value.format !== 'astrale.typespec.v2.module-observations' ||
    value.version !== 4 ||
    value.complete !== true ||
    !value.nativeDigest ||
    !Array.isArray(value.moduleIds) ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.transactions)
  ) {
    throw new Error('Full-corpus conformance requires a complete v4 native transaction checkpoint.')
  }
  if (
    new Set(value.moduleIds).size !== value.moduleIds.length ||
    new Set(value.transactions.map(([project]) => project)).size !== value.transactions.length ||
    value.projects.length !== value.transactions.length
  ) {
    throw new Error(
      'Checkpoint contains duplicate or missing module/project transaction identities.',
    )
  }
}

export function validateCheckpointModules(
  checkpoint: Pick<ObservationCheckpoint, 'moduleIds' | 'modulesDigest'>,
  modules: ReadonlyMap<string, TypeScriptModuleFact>,
): void {
  if (
    JSON.stringify([...modules.keys()]) !== JSON.stringify(checkpoint.moduleIds) ||
    digestModuleMap(modules) !== checkpoint.modulesDigest
  ) {
    throw new Error('V4 module index does not match its authoritative transactions.')
  }
}

export function modulesFromTransactions(
  transactions: ReadonlyMap<string, FactTransaction>,
): ReadonlyMap<string, TypeScriptModuleFact> {
  const modules = new Map<string, TypeScriptModuleFact>()
  for (const transaction of transactions.values()) {
    for (const fact of transaction.upserts.flatMap((shard) => shard.facts)) {
      if (fact.namespace !== TYPESCRIPT_MODULE_FACT_NAMESPACE || fact.kind !== 'module') continue
      if (modules.has(fact.subject)) {
        throw new Error(`Duplicate native module fact ${fact.subject}.`)
      }
      modules.set(fact.subject, fact.payload as TypeScriptModuleFact)
    }
  }
  return new Map([...modules].sort(([left], [right]) => compare(left, right)))
}

export function digestModuleMap(
  modules: ReadonlyMap<string, TypeScriptModuleFact>,
): string {
  const hash = createHash('sha256')
  for (const [id, module] of [...modules].sort(([left], [right]) => compare(left, right))) {
    hash.update(id)
    hash.update('\0')
    hash.update(JSON.stringify(module))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
