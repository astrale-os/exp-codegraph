import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const digest = (value) => createHash('sha256').update(value).digest('hex')

/** Exercise the installed decision service and its real packaged worker.
 * The supplied policy fixture disables all domain rules: this is a generic
 * journal/publication control, not SDK Source49 or complete-report parity.
 * root belongs exclusively to the caller's temporary qualification directory.
 */
export async function qualifyOwnedGeneric({ decisions, worker, root, repositoryRoot }) {
  // Shared with the independent Go inventory regression, not extracted from
  // the production map and not a second copied SDK policy catalog.
  const revisions = JSON.parse(await readFile(join(repositoryRoot,
    'analysis/typescript/native/testdata/governance-rule-revisions.json'), 'utf8'))
  const entries = Object.entries(revisions)
  assert.equal(entries.length, 52)
  assert(entries.every(([id, revision]) => /^[A-Z][A-Z0-9-]+$/u.test(id) && /^[a-f0-9]{64}$/u.test(revision)))
  const source = {
    rules: 'id\tscope\tkind\tseverity\tmessage\tverification\texample\nIMP-STATIC\timports\tdependency\terror\tmessage\tproof\tproof.md\n',
    layers: [{ id: 'schema', sourcePath: 'schema/', required: true },
      { id: 'mutations', sourcePath: 'mutations/', required: false },
      { id: 'tests', sourcePath: 'tests/', required: false }],
    rootFiles: [{ id: 'package', sourcePath: 'index.ts', role: 'package-facade', required: true }],
    dependencies: [], aliases: [],
  }
  const semantic = new Set(['QRY-CANON', 'QRY-SINGLE', 'QLT-DEF-IDS'])
  const fixture = {
    prepare: { projectionMode: 'sdk-rule-products', basePolicyDigest: 'canonical', policySource: source,
      ruleRevisions: entries.map(([id, revision]) => ({ id, revision })),
      options: { generic: true, sourcePolicyOwnerRevision: 2, requiredRuleIds: [] } },
    policy: { policy: { source, digest: 'canonical',
      disabled: entries.map(([ruleId]) => ({ ruleId, reason: 'generic-journal fixture' })),
      ignorePatterns: [], ignorePatternUnits: [] },
    implementationContracts: entries.map(([ruleId, ruleRevision]) => ({ ruleId, ruleRevision,
      requiredFacts: [], implementation: { id: semantic.has(ruleId) ? 'astrale.sdk.codegraph' : 'astrale.sdk.typescript-source', version: '1' } })),
    leafAuthority: { neutralClassIconSVG: '' } },
  }
  await mkdir(join(root, 'mutations'), { recursive: true })
  await writeFile(join(root, 'mutations/source.ts'), 'export const value=1;\n')
  const packagePath = join(root, 'package.json')
  await writeFile(packagePath, JSON.stringify({ version: worker.engineVersion }))
  const engine = { version: worker.engineVersion, artifactDigest: worker.sha256,
    packagePath, packageRevision: digest(await readFile(packagePath)) }
  const session = await decisions.openNativeDecisionSession({ root })
  const owners = []
  async function products() {
    const configuration = await session.prepare({ ...fixture.prepare, root })
    assert.equal(configuration.status, 'configuration')
    const token = configuration.token
    const generic = await session.continue({ ...fixture.policy, token, kind: 'policy' })
    assert.equal(generic.status, 'generic', JSON.stringify(generic))
    const selected = await session.continue({ token, kind: 'generic-engine', engine })
    assert.equal(selected.status, 'generic')
    const request = { token, configPath: join(root, '.oxlintrc.json'),
      config: { categories: { correctness: 'off' } }, commandIgnorePatterns: [] }
    const stale = await session.captureOwnedGeneric({ ...request, token: 'wrong-token' })
    assert.equal(stale.status, 'retry')
    const captured = await session.captureOwnedGeneric(request)
    assert.equal(captured.status, 'owned-generic', JSON.stringify(captured))
    assert.equal(captured.token, token)
    assert.equal(typeof captured.instance, 'string')
    assert(Number.isSafeInteger(captured.epoch) && captured.epoch > 0)
    assert(captured.membership.paths.length > 0)
    assert.deepEqual(captured.lint.output.diagnostics, [])
    assert.equal(typeof captured.inputCertificate, 'string')
    owners.push({ instance: captured.instance, epoch: captured.epoch })
    const source = await session.continue({ token, kind: 'generic', engine,
      inputCertificate: captured.inputCertificate,
      generic: { status: 'complete', files: captured.membership.paths.length,
        diagnostics: captured.lint.output.diagnostics } })
    assert.equal(source.status, 'source', JSON.stringify(source))
    // Acknowledge the actual native source-frame identity. With all domain
    // rules disabled, no invented Source49 decisions are supplied.
    const result = await session.continue({ token, kind: 'source-open',
      generation: source.generation, sourceSnapshotDigest: source.sourceSnapshotDigest })
    assert.equal(result.status, 'products', JSON.stringify(result))
    const reportDigest = digest(JSON.stringify({ productsJSON: result.productsJSON,
      generic: captured.lint.output }))
    return { token, productsDigest: result.productsDigest, reportDigest }
  }
  try {
    const first = await products()
    const committed = await session.seal(first)
    assert.equal(committed.status, 'committed')
    const changed = await products()
    await writeFile(join(root, '.gitignore'), 'changed-after-owned-close\n')
    const rejected = await session.seal(changed)
    assert.equal(rejected.status, 'retry', 'A new worker-observed ignore file must invalidate the joined publication.')
    await unlink(join(root, '.gitignore'))
    const repaired = await products()
    const recovered = await session.seal(repaired)
    assert.equal(recovered.status, 'committed')
    assert.equal(owners.length, 3)
    assert(owners.every((owner) => owner.instance === owners[0].instance), 'The resident session should reuse its real worker process.')
    assert(owners[0].epoch < owners[1].epoch && owners[1].epoch < owners[2].epoch)
    return { engineVersion: worker.engineVersion, artifactSha256: worker.sha256,
      attempts: 3, owners, outcomes: [committed.status, rejected.status, recovered.status],
      scope: 'Installed Go + actual packaged worker; generic journal guards only, domain rules disabled.' }
  } finally {
    await session.dispose()
  }
}
