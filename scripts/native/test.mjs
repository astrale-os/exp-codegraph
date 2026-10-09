import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import { resolveNativeToolchain } from './toolchain.mjs'
import { assertArtifactManifest, assertRegularExecutable, digestFile, readJson, stableJson } from './shared.mjs'

const root = resolve(import.meta.dirname, '../..')
const toolchain = await resolveNativeToolchain()
const temporary = await mkdtemp(join(tmpdir(), 'codegraph-native-tests-'))
try {
  // Match ttsc's source-plugin workspace: local plugin, installed ttsc and its
  // installed shim modules, with the exact v0.0.0 ttsc replacement it owns.
  const modules = [resolve(root, 'analysis/typescript/native'), toolchain.root,
    ...await shimModules(resolve(toolchain.root, 'shim'))]
  const work = resolve(temporary, 'go.work')
  const quote = (path) => JSON.stringify(path.replaceAll('\\', '/'))
  await writeFile(work, `go 1.26\nuse (\n${modules.map((path) => `\t${quote(path)}`).join('\n')}\n)\nreplace github.com/samchon/ttsc/packages/ttsc v0.0.0 => ${quote(toolchain.root)}\n`)
  const argument = (name, fallback) => {
    const index = process.argv.indexOf(name)
    return index < 0 ? fallback : JSON.parse(process.argv[index + 1])
  }
  const files = argument('--files-json', [])
  const options = argument('--options-json', [])
  const ownedIndex = process.argv.indexOf('--owned-artifact')
  const mandatory = new Map([
    'TestOwnedGenericArtifactAndProcessHaveDistinctLifetimes',
    'TestOwnedGenericExplicitArtifactLocation',
    'TestPolicyLaneOwnedOriginalJournalRetainsIndependentFreshGuards',
  ].map((name) => [name, { ran: false, passed: false, rejected: false }]))
  if (ownedIndex >= 0) {
    if (files.length !== 1 || files[0] !== '.') {
      throw new Error('--owned-artifact requires --files-json ["."]; the fixture flag belongs to the main package.')
    }
    const path = process.argv[ownedIndex + 1]
    if (!path || path.startsWith('--')) throw new Error('--owned-artifact requires the built worker path.')
    const worker = resolve(path)
    const output = dirname(dirname(worker))
    const packageVersion = (await readJson(resolve(root, 'package.json'))).version
    const target = `${process.platform}-${process.arch}`
    const artifact = assertArtifactManifest(await readJson(resolve(output, 'manifest.json')), target, packageVersion, { requireOxlint: true })
    const build = await readJson(resolve(output, 'build.json'))
    if (stableJson(build.artifact) !== stableJson(artifact) || worker !== resolve(output, artifact.oxlint.executable)) {
      throw new Error('Owned worker fixture differs from its native build manifest.')
    }
    await assertRegularExecutable(worker, target)
    if (stableJson(await digestFile(worker)) !== stableJson({ bytes: artifact.oxlint.bytes, sha256: artifact.oxlint.sha256 })) {
      throw new Error('Owned worker fixture bytes differ from its native build manifest.')
    }
    if (options.some((option) => /^-ldflags(?:=|$)|^-owned-artifact(?:=|$)/u.test(option))) {
      throw new Error('Owned worker fixture identity cannot be overridden by test options.')
    }
    const module = (await readFile(resolve(root, 'analysis/typescript/native/go.mod'), 'utf8')).match(/^module (\S+)$/mu)?.[1]
    if (!module) throw new Error('Native test module identity is missing.')
    // Executable builds name this package main; go test names the tested package
    // by its module import path. Configure both, with the same authenticated values.
    const values = { governanceOwnedArtifactSHA: artifact.oxlint.sha256,
      governanceOwnedArtifactBytes: String(artifact.oxlint.bytes),
      governanceOwnedEngineVersion: artifact.oxlint.engineVersion,
      governanceOwnedProtocolVersion: String(artifact.oxlint.protocolVersion) }
    const flags = ['main', module].flatMap((owner) => Object.entries(values).map(([name, value]) => `-X=${owner}.${name}=${value}`))
    options.push(`-ldflags=${flags.join(' ')}`, `-owned-artifact=${worker}`, '-json=true')
  }
  let eventError
  const code = await new Promise((complete, reject) => {
    const child = spawn(toolchain.go, ['test', ...(files.length ? files : ['./analysis/typescript/native/...']), '-count=1', ...options], {
      cwd: files.length ? resolve(root, 'analysis/typescript/native') : root,
      stdio: ownedIndex >= 0 ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      env: { ...process.env, GOTOOLCHAIN: 'local', GOWORK: work },
    })
    if (ownedIndex >= 0) {
      const decoder = new StringDecoder('utf8')
      let pending = ''
      const inspect = (line) => {
        try {
          const event = JSON.parse(line)
          const state = mandatory.get(event.Test)
          if (!state) return
          if (event.Action === 'run') state.ran = true
          if (event.Action === 'pass') state.passed = true
          if (event.Action === 'skip' || event.Action === 'fail') state.rejected = true
        } catch {
          eventError ??= 'Owned native test output is not a Go JSON event stream.'
        }
      }
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk)
        pending += decoder.write(chunk)
        let newline
        while ((newline = pending.indexOf('\n')) >= 0) {
          if (!eventError) inspect(pending.slice(0, newline))
          pending = pending.slice(newline + 1)
        }
        if (Buffer.byteLength(pending) > 4 * 1024 * 1024) {
          eventError ??= 'Owned native test event exceeds its line bound.'
          pending = ''
        }
      })
      child.stdout.once('end', () => {
        pending += decoder.end()
        if (pending.trim() && !eventError) inspect(pending)
      })
    }
    child.once('error', reject)
    child.once('close', (code, signal) => signal ? reject(new Error(`Native tests terminated by ${signal}.`)) : complete(code))
  })
  process.exitCode = code ?? 1
  if (ownedIndex >= 0) {
    const missing = [...mandatory].filter(([, state]) => !state.ran || !state.passed || state.rejected).map(([name]) => name)
    if (eventError || missing.length) {
      throw new Error(eventError ?? `Owned native mandatory tests did not pass without skip/fail: ${missing.join(', ')}.`)
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function shimModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const modules = entries.some((entry) => entry.name === 'go.mod') ? [directory] : []
  for (const entry of entries) {
    if (entry.isDirectory()) modules.push(...await shimModules(join(directory, entry.name)))
  }
  return modules.sort()
}
