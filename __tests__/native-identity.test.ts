import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { it } from 'vitest'

it('preserves canonical native identity preimages, including retained fuzz regressions', async () => {
  const require = createRequire(import.meta.url)
  const ttsc = createRequire(require.resolve('ttsc/package.json'))
  const platform = dirname(ttsc.resolve(`@ttsc/${process.platform}-${process.arch}/package.json`))
  const go = resolve(platform, 'bin/go/bin', process.platform === 'win32' ? 'go.exe' : 'go')
  await promisify(execFile)(go, ['test', 'canonical.go', 'canonical_test.go', 'identity.go', 'model.go', '-count=1'], {
    cwd: resolve(import.meta.dirname, '../analysis/typescript/native'),
    timeout: 90_000,
    env: { ...process.env, GOTOOLCHAIN: 'local' },
  })
}, 95_000)
