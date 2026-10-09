import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildViewerArchive } from './archive.mjs'

const root = resolve(import.meta.dirname, '../..')
const args = process.argv.slice(2)
const assetsOption = args.indexOf('--assets-dir')
if (args.length && (assetsOption !== 0 || args.length !== 2 || !args[1])) throw new Error('Usage: node scripts/viewer/assemble.mjs [--assets-dir directory]')
const assets = resolve(root, assetsOption === -1 ? '.viewer-release-assets' : args[1])
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error('Viewer release requires an exact source revision.')
const changedInputs = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'viewer', 'scripts/build-viewer.mjs', 'scripts/viewer', 'package.json', 'pnpm-lock.yaml'], { cwd: root, encoding: 'utf8' }).trim()
if (changedInputs) throw new Error('Viewer release inputs differ from the checked-out source revision.')
// CI may pin the expected checkout, but cannot rewrite the artifact identity.
if (process.env.SOURCE_REVISION && process.env.SOURCE_REVISION !== sourceRevision) throw new Error('Viewer SOURCE_REVISION differs from the checked-out revision.')
const { version: packageVersion } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(packageVersion)) throw new Error('Viewer release requires a package version.')
const { gzip, descriptor } = await buildViewerArchive(resolve(root, 'dist/viewer'))
const asset = `viewer-${sourceRevision}.tar.gz`
const release = { format: 'codegraph.viewer-release.v1', packageVersion, sourceRevision, asset, ...descriptor }
const json = JSON.stringify(release, null, 2) + '\n'
await mkdir(assets, { recursive: true })
await writeFile(resolve(assets, asset), gzip)
await writeFile(resolve(assets, 'viewer-release.json'), json)
await writeFile(resolve(root, 'viewer-release.json'), json)
console.log(JSON.stringify({ asset, packageVersion, sourceRevision, ...descriptor }))
