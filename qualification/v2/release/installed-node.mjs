import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

/** Product children use the selected Node runtime, without the source harness's loaders. */
export function runInstalledNode(args, options = {}) {
  return execFile(process.execPath, args, {
    ...options,
    env: { ...process.env, ...options.env, NODE_OPTIONS: '' },
  })
}
