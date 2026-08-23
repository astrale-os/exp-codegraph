import { basename } from 'node:path'

import { specificationApiCompiler } from '../../compiler/default.ts'
import { apiCompilerIsolationWork } from '../../compiler/isolation-work.optimization.ts'
import { SPECIFICATION_COMPILER_BATCH_CAPACITY } from '../../source/resource-limits.ts'
import { withOperationSnapshot } from '../../source/operation-snapshot.ts'
import type { ModuleFile, ModuleFileInventory } from '../module/inventory.ts'
import { inventoryModuleFiles } from '../module/inventory.ts'
import { prepareModuleTypeScriptAnalyses } from '../module/typescript.ts'
import type { SpecificationSnapshot } from './model.ts'
import {
  configureSpecificationDeclarationModels,
  configureSpecificationDeclarationNavigation,
  seedSpecificationDeclarationResources,
} from '../declaration.ts'

import { compileSpecificationSnapshot } from './compile.ts'

export interface SpecificationCompilationBatchOptions {
  readonly maximumConcurrency?: number
  readonly onPhase?: (phase: SpecificationCompilationPhase) => void
  /** Untrusted candidates whose declaration dependencies must still validate before reuse. */
  readonly previous?: readonly SpecificationSnapshot[]
  readonly changed?: readonly string[]
  /** Include presentation-only declaration source navigation in compiled API models. */
  readonly includeDeclarationNavigation?: boolean
  /** Include complete normalized declaration models after exact diagnostics pass. */
  readonly includeDeclarationModels?: boolean
}

export interface SpecificationCompilationPhase {
  readonly phase: 'inventory' | 'declarations' | 'typescript' | 'snapshots'
  readonly durationMs: number
  readonly items: number
  readonly programs?: number
  readonly sessions?: number
  readonly retries?: number
  readonly fallbacks?: number
  readonly workerPeakResidentBytes?: number
  readonly workerResidentUpperBoundBytes?: number
  readonly parentPeakResidentBytes?: number
  /** These phases deliberately overlap over independently owned immutable inputs. */
  readonly overlap?: 'typescript-snapshots'
}

/**
 * Compile one coherent corpus through bounded shared declaration and TypeScript waves.
 * The preparation stage is an optimization only; every module still compiles into its
 * independently content-addressed normative snapshot.
 */
export function compileSpecificationSnapshots(
  root: string,
  directories: readonly string[],
  options: SpecificationCompilationBatchOptions = {},
): Promise<readonly SpecificationSnapshot[]> {
  return withOperationSnapshot(async () => {
    const includeDeclarationNavigation = options.includeDeclarationNavigation !== false
    const includeDeclarationModels = options.includeDeclarationModels !== false
    if (includeDeclarationNavigation && !includeDeclarationModels) {
      throw new TypeError('Declaration navigation requires declaration models.')
    }
    configureSpecificationDeclarationNavigation(includeDeclarationNavigation)
    configureSpecificationDeclarationModels(includeDeclarationModels)
    const maximum = positiveInteger(
      options.maximumConcurrency,
      SPECIFICATION_COMPILER_BATCH_CAPACITY,
    )
    const moduleDirectories = directories.filter(
      (directory) => basename(directory) === '.spec',
    )
    let started = performance.now()
    const inventories = await mapConcurrent(
      moduleDirectories,
      maximum,
      (directory) => inventoryModuleFiles(root, directory),
    )
    report(options.onPhase, {
      phase: 'inventory',
      durationMs: performance.now() - started,
      items: inventories.length,
    })
    const restoredDeclarations = seedSpecificationDeclarationResources(
      options.previous ?? [],
      options.changed ?? [],
    )
    const typeScript = await prepareSpecificationCompilation(
      root,
      inventories,
      options.onPhase,
      restoredDeclarations,
      includeDeclarationNavigation,
      includeDeclarationModels,
    )
    await Promise.race([typeScript.scheduled, typeScript.completed])
    const snapshotsStarted = performance.now()
    const snapshotsPending = mapConcurrent(
      moduleDirectories,
      maximum,
      (directory) => compileSpecificationSnapshot(root, directory),
    )
    await typeScript.completed
    report(options.onPhase, {
      phase: 'typescript',
      durationMs: performance.now() - typeScript.started,
      items: inventories.length,
      programs: typeScript.programs(),
      sessions: 1,
      overlap: 'typescript-snapshots',
    })
    const snapshots = await snapshotsPending
    report(options.onPhase, {
      phase: 'snapshots',
      durationMs: performance.now() - snapshotsStarted,
      items: snapshots.length,
      overlap: 'typescript-snapshots',
    })
    return snapshots.sort((left, right) => compare(left.source, right.source))
  })
}

async function prepareSpecificationCompilation(
  root: string,
  inventories: readonly ModuleFileInventory[],
  onPhase: SpecificationCompilationBatchOptions['onPhase'],
  restored: ReadonlySet<string>,
  includeDeclarationNavigation: boolean,
  includeDeclarationModels: boolean,
) {
  const declarations = uniqueFiles(
    inventories.flatMap((inventory) => [
      inventory.api,
      ...(inventory.internal ? [inventory.internal] : []),
      ...inventory.ports,
    ]),
  ).filter((file) => !restored.has(file.source))
  let started = performance.now()
  await Promise.all(
    declarations.map((file) =>
      specificationApiCompiler.compile({
        mainFile: file.absolute,
        projectRoot: root,
        declarationNavigation: includeDeclarationNavigation,
        declarationModel: includeDeclarationModels,
      }),
    ),
  )
  const isolation = apiCompilerIsolationWork()
  report(onPhase, {
    phase: 'declarations',
    durationMs: performance.now() - started,
    items: declarations.length,
    programs: isolation.programs,
    sessions: isolation.sessions,
    retries: isolation.retries,
    fallbacks: isolation.plannerFallbacks,
    workerPeakResidentBytes: isolation.workerPeakResidentBytes,
    workerResidentUpperBoundBytes: isolation.workerResidentUpperBoundBytes,
    parentPeakResidentBytes: process.resourceUsage().maxRSS * 1_024,
  })
  const typeScriptStarted = performance.now()
  let signalScheduled!: () => void
  const scheduled = new Promise<void>((resolve) => {
    signalScheduled = resolve
  })
  let programs = 0
  const completed = prepareModuleTypeScriptAnalyses(
    root,
    inventories,
    (phase) => {
      if (phase.phase === 'program') programs += phase.items
    },
    signalScheduled,
  )
  return { started: typeScriptStarted, scheduled, completed, programs: () => programs }
}

function report(
  observer: SpecificationCompilationBatchOptions['onPhase'],
  phase: SpecificationCompilationPhase,
): void {
  try {
    observer?.(phase)
  } catch {
    // Diagnostic observation cannot change canonical compilation.
  }
}

function uniqueFiles(files: readonly ModuleFile[]): ModuleFile[] {
  const values = new Map<string, ModuleFile>()
  for (const file of files) values.set(file.absolute, file)
  return [...values.values()].sort((left, right) => compare(left.source, right.source))
}

async function mapConcurrent<Input, Output>(
  inputs: readonly Input[],
  maximum: number,
  operation: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const output: Output[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(maximum, inputs.length) }, async () => {
      while (true) {
        const index = next++
        if (index >= inputs.length) return
        output[index] = await operation(inputs[index]!)
      }
    }),
  )
  return output
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('maximumConcurrency must be a positive safe integer.')
  }
  return value
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
