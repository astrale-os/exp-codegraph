import { build } from 'vite'
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

// Browser dependencies are compiled once, never discovered or installed by the running viewer.
await build({
  configFile: false,
  root: join(root, 'viewer'),
  base: '/',
  logLevel: 'warn',
  plugins: [browserNotices()],
  build: {
    outDir: join(root, 'dist/viewer'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  resolve: { dedupe: ['preact'] },
})

/** Keep original license texts, including prebundled Mermaid vendor notices, beside the assets. */
function browserNotices() {
  return {
    name: 'codegraph-browser-notices',
    async generateBundle(_options, bundle) {
      const packages = new Map()
      const comments = new Map()
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of Object.keys(output.modules)) {
          const file = id.split('?')[0]
          if (!isAbsolute(file)) continue
          const owner = await packageOwner(file)
          if (!owner || owner.manifest.name === '@astrale-os/codegraph') continue
          packages.set(owner.root, owner)
          const text = await readFile(file, 'utf8').catch(() => '')
          const notices = text.match(/\/\*![\s\S]*?\*\//g)
          if (notices?.length) comments.set(`${owner.manifest.name}/${relative(owner.root, file)}`, notices.join('\n\n'))
        }
      }
      // Mermaid ships vendor code already bundled into its ESM chunks. Include its resolved
      // normal dependency closure as a conservative notice set, not a final-link attribution.
      for (const owner of packages.values()) {
        const require = createRequire(join(owner.root, 'package.json'))
        for (const name of Object.keys(owner.manifest.dependencies ?? {})) {
          let path
          try { path = require.resolve(`${name}/package.json`) }
          catch {
            try { path = require.resolve(name) }
            catch { continue }
          }
          const dependency = await packageOwner(path)
          if (dependency) packages.set(dependency.root, dependency)
        }
      }
      const records = []
      const texts = new Map()
      for (const owner of [...packages.values()].sort((a, b) => `${a.manifest.name}@${a.manifest.version}`.localeCompare(`${b.manifest.name}@${b.manifest.version}`))) {
        const licenses = []
        for (const name of (await readdir(owner.root)).sort()) {
          if (!/^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name)) continue
          const text = await readFile(join(owner.root, name), 'utf8').catch(() => undefined)
          if (text === undefined) continue
          const sha256 = createHash('sha256').update(text).digest('hex')
          texts.set(sha256, text)
          licenses.push({ file: name, sha256 })
        }
        if (!licenses.length) throw new Error(`Bundled dependency ${owner.manifest.name}@${owner.manifest.version} has no supplied license text.`)
        records.push({ name: owner.manifest.name, version: owner.manifest.version, license: owner.manifest.license, notices: licenses })
      }
      const notices = [
        'Codegraph embedded viewer — third-party notices',
        'The package set includes the conservative normal dependency closure of rendered browser modules. Original prebundled vendor comments are also retained below.',
        ...records.map((record) => `${record.name}@${record.version} (${record.license}): ${record.notices.map((notice) => `${notice.file} [${notice.sha256}]`).join(', ')}`),
        ...[...texts].map(([hash, text]) => `\n--- ${hash} ---\n\n${text}`),
        ...[...comments].sort(([a], [b]) => a.localeCompare(b)).map(([file, text]) => `\n--- Original vendor notices: ${file} ---\n\n${text}`),
      ].join('\n\n')
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: notices })
      this.emitFile({ type: 'asset', fileName: 'viewer-build.json', source: JSON.stringify({ format: 'codegraph.viewer-build.v1', packages: records }, null, 2) + '\n' })
    },
  }
}

async function packageOwner(file) {
  let directory = dirname(file)
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      const parent = dirname(directory)
      const packageRoot = basename(parent) === 'node_modules' || (basename(parent).startsWith('@') && basename(dirname(parent)) === 'node_modules')
      if (manifest.name && (packageRoot || directory === root)) return { root: await realpath(directory), manifest }
    } catch {}
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}
