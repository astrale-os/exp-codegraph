import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const microPath = resolve(requiredArgument('--micro'))
const codegraphPath = resolve(requiredArgument('--codegraph'))
const kernelPath = resolve(requiredArgument('--kernel'))
const rejectedPath = resolve(requiredArgument('--rejected'))
const nativePath = resolve(requiredArgument('--native-binary'))
const kernelRevision = requiredArgument('--kernel-revision')
const output = resolve(requiredArgument('--output'))

const micro = await json<MicroResult>(microPath)
const codegraph = await json<ProjectResult>(codegraphPath)
const kernel = await json<ProjectResult>(kernelPath)
const rejected = await json<ProjectResult>(rejectedPath)

assert.equal(micro.format, 'astrale.codegraph.projection-plan-equivalence')
assert.equal(micro.exactNamespaceProjection, true)
assert.equal(micro.stableUniverseAcrossProjectionPlans, true)
assert.equal(micro.moduleBoundaryChangesGenerationOnly, true)
assert.equal(micro.unrequestedSemanticStagesExecuted, 0)
assert.equal(micro.capabilities.length, 7)
qualifyProject(codegraph, 'codegraph')
qualifyProject(kernel, 'kernel')
assert.equal(rejected.target, 'codegraph')
assert.equal(rejected.exactSelectedFacts, false)
const rejectedBody = selection(rejected, 'typescript.body')
assert(rejectedBody.differences.length > 0)
assert(rejectedBody.differences.every((difference) =>
  difference.firstDifference?.path.includes('.signature')))

const result = {
  format: 'astrale.codegraph.v2.demand-driven-projection-qualification',
  version: 1,
  status: 'qualified',
  qualifiedRequirements: ['V2-ANA-012'],
  invariants: {
    exactSelectedFactEnvelopes: true,
    stableUniverseAcrossProjectionPlans: true,
    stableSourceManifestAcrossProjectionPlans: true,
    unrequestedSemanticPhasesExecuted: 0,
    moduleBoundaryChangesGenerationOnly: true,
  },
  codegraph: evidence(codegraph),
  kernel: evidence(kernel),
  regression: {
    rejectedBodyFacts: rejectedBody.facts,
    differingBodyFacts: rejectedBody.differences.length,
    cause: 'SignatureToStringEx alias expansion and truncation depended on unrelated checker walks.',
    correction: 'Resolved call signatures use stable fully-qualified parameter and return type rendering.',
    witnesses: rejectedBody.differences.map((difference) => ({
      key: difference.key,
      path: difference.firstDifference?.path,
      expected: difference.firstDifference?.expected,
      actual: difference.firstDifference?.actual,
    })),
  },
  provenance: {
    kernelRevision,
    nativeSha256: await digest(nativePath),
    artifacts: {
      micro: await artifact(microPath),
      codegraph: await artifact(codegraphPath),
      kernel: await artifact(kernelPath),
      rejected: await artifact(rejectedPath),
    },
    commands: [
      'node qualification/v2/experiments/projection-plan.ts --native-binary <binary> --output <artifact>',
      'node qualification/v2/experiments/projection-project.ts --target codegraph --root . --project tsconfig.json --native-binary <binary> --output <artifact> --require-exact',
      'node qualification/v2/experiments/projection-project.ts --target kernel --root <clean-kernel> --project core/tsconfig.json --native-binary <binary> --output <artifact> --require-exact',
    ],
  },
}

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify({
  format: result.format,
  status: result.status,
  codegraphModuleRatio: result.codegraph.module.fullOverSelected,
  kernelModuleRatio: result.kernel.module.fullOverSelected,
  exactSelectedFacts: result.invariants.exactSelectedFactEnvelopes,
  output,
}, null, 2)}\n`)

function qualifyProject(value: ProjectResult, target: 'codegraph' | 'kernel'): void {
  assert.equal(value.format, 'astrale.codegraph.projection-project-equivalence')
  assert.equal(value.target, target)
  assert.equal(value.exactSelectedFacts, true)
  assert.equal(value.stableUniverse, true)
  assert.equal(value.stableSourceManifest, true)
  assert.equal(value.unrequestedSemanticPhasesExecuted, 0)
  for (const namespace of ['astrale.typescript.module', 'typescript.body']) {
    const selected = selection(value, namespace)
    assert.equal(selected.exactSelectedFacts, true)
    assert.equal(selected.digest, value.full.namespaceDigests[namespace])
    assert.deepEqual(selected.semanticPhases, [expectedPhase(namespace)])
    assert.deepEqual(selected.unrequestedSemanticPhases, [])
    assert.deepEqual(selected.differences, [])
  }
}

function evidence(value: ProjectResult) {
  return {
    project: value.project,
    modules: value.modules,
    fullMs: value.full.elapsedMs,
    universe: value.full.universe,
    sourceManifest: value.full.sourceManifest,
    module: selectionEvidence(value, 'astrale.typescript.module'),
    body: selectionEvidence(value, 'typescript.body'),
  }
}

function selectionEvidence(value: ProjectResult, namespace: string) {
  const selected = selection(value, namespace)
  return {
    facts: selected.facts,
    elapsedMs: selected.elapsedMs,
    fullOverSelected: round(value.full.elapsedMs / selected.elapsedMs),
    digest: selected.digest,
    exactSelectedFacts: selected.exactSelectedFacts,
    semanticPhases: selected.semanticPhases,
  }
}

function selection(value: ProjectResult, namespace: string): Selection {
  const found = value.selections.find((candidate) => candidate.namespace === namespace)
  if (!found) throw new Error(`${value.target} omitted ${namespace}.`)
  return found
}

function expectedPhase(namespace: string): string {
  return namespace === 'astrale.typescript.module' ? 'projection.modules' : 'projection.bodies'
}

async function json<Value>(path: string): Promise<Value> {
  return JSON.parse(await readFile(path, 'utf8')) as Value
}

async function artifact(path: string) {
  return { sha256: await digest(path) }
}

async function digest(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`Missing required ${name}.`)
  return value
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

interface MicroResult {
  readonly format: string
  readonly capabilities: readonly unknown[]
  readonly exactNamespaceProjection: boolean
  readonly stableUniverseAcrossProjectionPlans: boolean
  readonly moduleBoundaryChangesGenerationOnly: boolean
  readonly unrequestedSemanticStagesExecuted: number
}

interface Difference {
  readonly key: string
  readonly firstDifference?: {
    readonly path: string
    readonly expected?: unknown
    readonly actual?: unknown
  }
}

interface Selection {
  readonly namespace: string
  readonly elapsedMs: number
  readonly facts: number
  readonly digest: string
  readonly semanticPhases: readonly string[]
  readonly unrequestedSemanticPhases: readonly string[]
  readonly exactSelectedFacts: boolean
  readonly differences: readonly Difference[]
}

interface ProjectResult {
  readonly format: string
  readonly target: string
  readonly project: string
  readonly modules: number
  readonly full: {
    readonly elapsedMs: number
    readonly universe: string
    readonly sourceManifest: string
    readonly namespaceDigests: Readonly<Record<string, string>>
  }
  readonly selections: readonly Selection[]
  readonly exactSelectedFacts: boolean
  readonly stableUniverse: boolean
  readonly stableSourceManifest: boolean
  readonly unrequestedSemanticPhasesExecuted: number
}
