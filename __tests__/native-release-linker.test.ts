import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const build = vi.hoisted(() => ({ command: '', inputs: [] as { env?: NodeJS.ProcessEnv }[] }))
vi.mock('ttsc', () => ({ TtscCompiler: class {
  constructor(options: { env?: NodeJS.ProcessEnv }) { build.inputs.push(options) }
  prepare() { return [build.command] }
} }))
import { resolveTtscNativeAnalysis } from '../analysis/typescript/ttsc/native.ts'

const temporary: string[] = []
const worker = {
  executable: 'bin/codegraph-oxlint', bytes: 42, sha256: 'a'.repeat(64),
  engineVersion: '1.81.0', protocolVersion: 1,
  source: { revision: 'b'.repeat(40), patchSha256: 'c'.repeat(64) },
} as const
beforeEach(() => { build.inputs.length = 0; vi.stubEnv('GOFLAGS', '') })
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-linker-'))
  temporary.push(root)
  build.command = join(root, 'native')
  await writeFile(build.command, 'qualified fixture')
  await chmod(build.command, 0o755)
  return { root, config: 'tsconfig.json' }
}

describe('native release build settings', () => {
  it('separates debug, stripped and companion-linked source-plugin cache entries', async () => {
    const options = await fixture()
    await resolveTtscNativeAnalysis(options)
    await resolveTtscNativeAnalysis({ ...options, stripDebugInfo: true })
    await resolveTtscNativeAnalysis({ ...options, ownedOxlint: worker })
    const combined = { ...options, stripDebugInfo: true, ownedOxlint: worker }
    await resolveTtscNativeAnalysis(combined)
    await resolveTtscNativeAnalysis(combined)
    expect(build.inputs).toHaveLength(4)
    expect(build.inputs[0]!.env).toBeUndefined()
    expect(build.inputs[1]!.env?.GOFLAGS).toBe('"-ldflags=-s -w"')
    expect(build.inputs[2]!.env?.GOFLAGS).not.toContain('-s -w')
    for (const linked of build.inputs.slice(2)) {
      expect(linked.env?.GOFLAGS).toContain(`-X=main.governanceOwnedArtifactSHA=${worker.sha256}`)
      expect(linked.env?.GOFLAGS).toContain('-X=main.governanceOwnedArtifactBytes=42')
      expect(linked.env?.GOFLAGS).toContain('-X=main.governanceOwnedEngineVersion=1.81.0')
      expect(linked.env?.GOFLAGS).toContain('-X=main.governanceOwnedProtocolVersion=1')
    }
    expect(build.inputs[3]!.env?.GOFLAGS).toContain('-s -w')
  })

  it('retains ordinary inherited Go flags and release environment', async () => {
    vi.stubEnv('GOFLAGS', '-trimpath')
    const options = await fixture()
    await resolveTtscNativeAnalysis({ ...options, stripDebugInfo: true, environment: { CGO_ENABLED: '0' } })
    expect(build.inputs[0]!.env).toEqual({ CGO_ENABLED: '0', GOFLAGS: '-trimpath "-ldflags=-s -w"' })
  })

  it.each(['-ldflags=-w', '-trimpath -ldflags=-w', '"-ldflags=-w"', "'-ldflags=-w'"])(
    'rejects competing linker flags before any build: %s', async (GOFLAGS) => {
      const options = await fixture()
      expect(() => resolveTtscNativeAnalysis({ ...options, stripDebugInfo: true, environment: { GOFLAGS } }))
        .toThrow('must own Go linker flags')
      expect(build.inputs).toHaveLength(0)
    },
  )

  it('rejects build settings for an explicit executable instead of pretending to strip it', async () => {
    const options = await fixture()
    expect(() => resolveTtscNativeAnalysis({ ...options, binary: build.command, stripDebugInfo: true }))
      .toThrow('explicit native binary')
    expect(build.inputs).toHaveLength(0)
  })
})
