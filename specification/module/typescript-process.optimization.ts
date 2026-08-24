import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import type { ModuleFileInventory } from './inventory.ts'
import type {
  ModuleTypeScriptIsolationEntry,
  ModuleTypeScriptIsolationGroupResult,
} from './typescript-model.ts'

const MAXIMUM_OLD_SPACE_MIB = 504
const MAXIMUM_OUTPUT_BYTES = 64 * 1_024 * 1_024
const MAXIMUM_STDERR_BYTES = 1 * 1_024 * 1_024
const TIMEOUT_MS = 60_000

export interface ModuleTypeScriptIsolationResult {
  readonly entries: readonly ModuleTypeScriptIsolationEntry[]
  readonly programs: number
  readonly workerPeakResidentBytes: number
  readonly workerResidentUpperBoundBytes: number
}

/** Execute exact preplanned whole-corpus groups serially behind bounded compiler heaps. */
export async function analyzeModuleTypeScriptGroupsIsolated(
  root: string,
  groups: readonly (readonly ModuleFileInventory[])[],
): Promise<ModuleTypeScriptIsolationResult> {
  const result = await runWorker(root, groups)
  return {
    entries: result.entries,
    programs: result.programs,
    workerPeakResidentBytes: result.peakResidentBytes,
    workerResidentUpperBoundBytes: result.peakResidentBytes,
  }
}

function runWorker(
  root: string,
  groups: readonly (readonly ModuleFileInventory[])[],
): Promise<ModuleTypeScriptIsolationGroupResult & { readonly peakResidentBytes: number }> {
  return new Promise((resolvePromise, reject) => {
    const worker = fileURLToPath(new URL('./typescript-worker.optimization.ts', import.meta.url))
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${MAXIMUM_OLD_SPACE_MIB}`, worker],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const finish = (error?: unknown, result?: ModuleTypeScriptIsolationGroupResult & { readonly peakResidentBytes: number }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise(result!)
    }
    const fail = (message: string) => {
      if (!child.killed) child.kill('SIGKILL')
      finish(new Error(message))
    }
    const timer = setTimeout(
      () => fail(`Specification TypeScript worker exceeded ${TIMEOUT_MS} ms.`),
      TIMEOUT_MS,
    )
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > MAXIMUM_OUTPUT_BYTES) return fail('Specification TypeScript worker output exceeded its limit.')
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > MAXIMUM_STDERR_BYTES) return fail('Specification TypeScript worker diagnostics exceeded their limit.')
      stderr.push(chunk)
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code, signal) => {
      if (settled) return
      if (code !== 0) {
        return finish(new Error(
          `Specification TypeScript worker exited with ${signal ?? code ?? 'unknown status'}: ${Buffer.concat(stderr).toString('utf8').trim()}`,
        ))
      }
      try {
        const result = JSON.parse(Buffer.concat(stdout).toString('utf8')) as ModuleTypeScriptIsolationGroupResult
        const resource = JSON.parse(Buffer.concat(stderr).toString('utf8')) as {
          readonly peakResidentBytes: number
        }
        if (!Number.isSafeInteger(resource.peakResidentBytes) || resource.peakResidentBytes < 1) {
          throw new Error('Specification TypeScript worker resource report is invalid.')
        }
        finish(undefined, { ...result, peakResidentBytes: resource.peakResidentBytes })
      } catch (error) {
        finish(error)
      }
    })
    child.stdin.end(JSON.stringify({ root, groups }))
  })
}
