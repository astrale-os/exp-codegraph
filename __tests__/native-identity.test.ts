import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/physical/index.ts'

it('preserves canonical native identity preimages, including retained fuzz regressions', async () => {
  await goTest(['canonical.go', 'canonical_test.go', 'identity.go', 'generation_identity.go', 'generation_identity_test.go', 'model.go'])
}, 95_000)

it('streams complete records across bounded frames before atomic admission', async () => {
  await goTest(['framing.go', 'framing_records.go', 'framing_records_test.go', 'model.go', 'telemetry.go'])
}, 95_000)

it('shares package ownership walks only within one compiler snapshot', async () => {
  await goTest(['package_coordinate.go', 'package_coordinate_test.go'])
}, 95_000)

it('indexes exact TypeScript UTF-16 coordinates without allocating for ASCII sources', async () => {
  await goTest(['source_coordinates.go', 'source_coordinates_test.go'])
}, 95_000)

it('shares prepared payload bytes across exact native fact and shard identities', async () => {
  await goTest(['canonical.go', 'identity.go', 'fact_identity.go', 'fact_identity_test.go', 'model.go', 'framing.go', 'framing_records.go', 'telemetry.go'])
}, 95_000)

it('preserves columnar and legacy packed native bodies with exact negotiation', async () => {
  const output = await goTest(['model.go', 'body_packed.go', 'body_packed_test.go'], ['-v'])
  const marker = 'CODEGRAPH_PACKED_BODY_FIXTURE '
  const lines = output.split('\n').filter(line => line.includes(marker))
  expect(lines).toHaveLength(1)
  const fixture = JSON.parse(lines[0]!.slice(lines[0]!.indexOf(marker) + marker.length)) as {
    logical: unknown
    legacy: { codec: string; data: unknown }
    columnar: { codec: string; data: unknown }
  }
  expect(fixture.legacy.codec).toBe('typescript.body.packed/5')
  expect(fixture.columnar.codec).toBe('typescript.body.packed/6')
  for (const envelope of [fixture.legacy, fixture.columnar]) {
    const codec = TYPESCRIPT_FACT_PAYLOAD_CODECS.find(codec => codec.id === envelope.codec)!
    expect(codec.decode(envelope.data)).toEqual(fixture.logical)
  }
}, 95_000)

async function goTest(files: readonly string[], options: readonly string[] = []): Promise<string> {
  const require = createRequire(import.meta.url)
  const ttsc = createRequire(require.resolve('ttsc/package.json'))
  const platform = dirname(ttsc.resolve(`@ttsc/${process.platform}-${process.arch}/package.json`))
  const go = resolve(platform, 'bin/go/bin', process.platform === 'win32' ? 'go.exe' : 'go')
  const { stdout } = await promisify(execFile)(go, ['test', ...files, '-count=1', ...options], {
    cwd: resolve(import.meta.dirname, '../analysis/typescript/native'),
    timeout: 90_000,
    env: { ...process.env, GOTOOLCHAIN: 'local' },
  })
  return stdout
}
