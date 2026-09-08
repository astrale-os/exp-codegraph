import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { it } from 'vitest'

it('preserves canonical native identity preimages, including retained fuzz regressions', async () => {
  await goTest(['canonical.go', 'canonical_test.go', 'identity.go', 'generation_identity.go', 'generation_identity_test.go', 'model.go'])
}, 95_000)

it('streams complete records across bounded frames before atomic admission', async () => {
  await goTest(['framing.go', 'framing_records.go', 'framing_records_test.go', 'model.go', 'telemetry.go'])
}, 95_000)

it('shares package ownership walks only within one compiler snapshot', async () => {
  await goTest(['package_coordinate.go', 'package_coordinate_test.go'])
}, 95_000)

it('shares prepared payload bytes across exact native fact and shard identities', async () => {
  await goTest(['canonical.go', 'identity.go', 'fact_identity.go', 'fact_identity_test.go', 'model.go', 'framing.go', 'framing_records.go', 'telemetry.go'])
}, 95_000)

async function goTest(files: readonly string[]): Promise<void> {
  const require = createRequire(import.meta.url)
  const ttsc = createRequire(require.resolve('ttsc/package.json'))
  const platform = dirname(ttsc.resolve(`@ttsc/${process.platform}-${process.arch}/package.json`))
  const go = resolve(platform, 'bin/go/bin', process.platform === 'win32' ? 'go.exe' : 'go')
  await promisify(execFile)(go, ['test', ...files, '-count=1'], {
    cwd: resolve(import.meta.dirname, '../analysis/typescript/native'),
    timeout: 90_000,
    env: { ...process.env, GOTOOLCHAIN: 'local' },
  })
}
