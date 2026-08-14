import { resolve } from 'node:path'

export const USAGE = `Usage:
  cg init [module-directory]
  cg check [root] [--select <relative-path>]... [--exclude <relative-path>]... [--require-complete-layout] [--require-exact-layout] [--quiet] [--no-cache]
  cg changed [root] [base] [--exclude <relative-path>]... [--require-complete-layout] [--scope-only] [--quiet] [--no-cache]
  cg test [module-path]... [--root <directory>] [--quiet] [--no-cache]
  cg test changed [base] [--root <directory>] [--quiet] [--no-cache]
  cg verify [root] [--select <relative-path>]... [--schema-root <directory>]... [--require-pass] [--details] [--quiet]
  cg dev [root] [--port <number>] [--open] [--verify] [--no-cache]`

export type CliCommand =
  | { name: 'help'; successful: boolean }
  | { name: 'init'; root: string }
  | {
      name: 'check'
      root: string
      exclude: readonly string[]
      select: readonly string[]
      requireCompleteLayout: boolean
      requireExactLayout: boolean
      quiet: boolean
      cache: boolean
    }
  | {
      name: 'verify'
      root: string
      select: readonly string[]
      schemaRoots: readonly string[]
      requirePass: boolean
      details: boolean
      quiet: boolean
    }
  | {
      name: 'changed'
      root: string
      base?: string
      exclude: readonly string[]
      requireCompleteLayout: boolean
      scopeOnly: boolean
      quiet: boolean
      cache: boolean
    }
  | {
      name: 'test'
      root: string
      select: readonly string[]
      changed: boolean
      base?: string
      quiet: boolean
      cache: boolean
    }
  | { name: 'dev'; root: string; port?: number; open: boolean; verify: boolean; cache: boolean }

export function parseCommand(
  input: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): CliCommand {
  const args = [...input]
  const cache = persistentCacheByDefault(environment)
  const command = args.shift()
  if (!command || command === '--help' || command === '-h') {
    return { name: 'help', successful: Boolean(command) }
  }
  if (command === 'check') {
    return { name: 'check', ...parseCheck(args, cache) }
  }
  if (command === 'changed') return { name: 'changed', ...parseChanged(args, cache) }
  if (command === 'init') return { name: 'init', root: parseSingleRoot(args) }
  if (command === 'test') return { name: 'test', ...parseTest(args, cache) }
  if (command === 'verify') return { name: 'verify', ...parseVerify(args) }
  if (command === 'dev') return { name: 'dev', ...parseDev(args, cache) }
  return usageError()
}

function parseTest(
  args: string[],
  cacheDefault: boolean,
): {
  root: string
  select: readonly string[]
  changed: boolean
  base?: string
  quiet: boolean
  cache: boolean
} {
  let root = '.'
  let quiet = false
  let cache = cacheDefault
  const values: string[] = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === '--root') {
      const value = args[++index]
      if (!value || value.startsWith('-')) usageError()
      root = value
    } else if (argument === '--quiet' && !quiet) quiet = true
    else if (argument === '--no-cache') cache = false
    else if (argument.startsWith('-')) usageError()
    else values.push(argument)
  }
  const changed = values[0] === 'changed'
  if (changed && values.length > 2) usageError()
  return {
    root: resolve(root),
    select: changed ? [] : values,
    changed,
    ...(changed && values[1] ? { base: values[1] } : {}),
    quiet,
    cache,
  }
}

function parseChanged(
  args: string[],
  cacheDefault: boolean,
): {
  root: string
  base?: string
  exclude: readonly string[]
  requireCompleteLayout: boolean
  scopeOnly: boolean
  quiet: boolean
  cache: boolean
} {
  let root = '.'
  let base: string | undefined
  let hasRoot = false
  const exclude: string[] = []
  let requireCompleteLayout = false
  let scopeOnly = false
  let quiet = false
  let cache = cacheDefault
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === '--exclude') {
      const value = args[++index]
      if (!value || value.startsWith('-')) usageError()
      exclude.push(value)
    } else if (argument === '--require-complete-layout' && !requireCompleteLayout) {
      requireCompleteLayout = true
    } else if (argument === '--scope-only' && !scopeOnly) {
      scopeOnly = true
    } else if (argument === '--quiet' && !quiet) {
      quiet = true
    } else if (argument === '--no-cache') {
      cache = false
    } else if (argument.startsWith('-')) usageError()
    else if (!hasRoot) {
      root = argument
      hasRoot = true
    } else if (base === undefined) base = argument
    else usageError()
  }
  return {
    root: resolve(root),
    ...(base ? { base } : {}),
    exclude,
    requireCompleteLayout,
    scopeOnly,
    quiet,
    cache,
  }
}

function parseSingleRoot(args: string[]): string {
  if (args.length > 1 || args[0]?.startsWith('-')) usageError()
  return resolve(args[0] ?? '.')
}

function parseCheck(
  args: string[],
  cacheDefault: boolean,
): {
  root: string
  exclude: readonly string[]
  select: readonly string[]
  requireCompleteLayout: boolean
  requireExactLayout: boolean
  quiet: boolean
  cache: boolean
} {
  let root = '.'
  let hasRoot = false
  const exclude: string[] = []
  const select: string[] = []
  let requireCompleteLayout = false
  let requireExactLayout = false
  let quiet = false
  let cache = cacheDefault
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--exclude') {
      const value = args[++index]
      if (!value || value.startsWith('-')) usageError()
      exclude.push(value)
    } else if (argument === '--select') {
      const value = args[++index]
      if (!value || value.startsWith('-')) usageError()
      select.push(value)
    } else if (argument === '--require-complete-layout' && !requireCompleteLayout) {
      requireCompleteLayout = true
    } else if (argument === '--require-exact-layout' && !requireExactLayout) {
      requireExactLayout = true
    } else if (argument === '--quiet' && !quiet) {
      quiet = true
    } else if (argument === '--no-cache') {
      cache = false
    } else if (argument.startsWith('-') || hasRoot) usageError()
    else {
      root = argument
      hasRoot = true
    }
  }
  return {
    root: resolve(root),
    exclude,
    select,
    requireCompleteLayout,
    requireExactLayout,
    quiet,
    cache,
  }
}

function parseVerify(args: string[]): {
  root: string
  select: readonly string[]
  schemaRoots: readonly string[]
  requirePass: boolean
  details: boolean
  quiet: boolean
} {
  let root = '.'
  let hasRoot = false
  const select: string[] = []
  const schemaRoots: string[] = []
  let requirePass = false
  let details = false
  let quiet = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === '--require-pass' && !requirePass) requirePass = true
    else if (argument === '--details' && !details) details = true
    else if (argument === '--quiet' && !quiet) quiet = true
    else if (argument === '--select') {
      const value = args[++index]
      if (!value || value.startsWith('-')) usageError()
      select.push(value)
    } else if (argument === '--schema-root') {
      const value = args[++index]
      if (!value || value.startsWith('-')) usageError()
      schemaRoots.push(resolve(value))
    } else if (argument.startsWith('-') || hasRoot) usageError()
    else {
      root = argument
      hasRoot = true
    }
  }
  return { root: resolve(root), select, schemaRoots, requirePass, details, quiet }
}

function parseDev(
  args: string[],
  cacheDefault: boolean,
): {
  root: string
  port?: number
  open: boolean
  verify: boolean
  cache: boolean
} {
  let root = '.'
  let hasRoot = false
  let port: number | undefined
  let open = false
  let verify = false
  let cache = cacheDefault
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--open') open = true
    else if (argument === '--verify') verify = true
    else if (argument === '--no-cache') cache = false
    else if (argument === '--port') {
      const value = args[++index]
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new Error('--port requires an integer from 0 to 65535.')
      }
      port = Number(value)
      if (port > 65_535) throw new Error('--port requires an integer from 0 to 65535.')
    } else if (argument.startsWith('-') || hasRoot) usageError()
    else {
      root = argument
      hasRoot = true
    }
  }
  return { root: resolve(root), port, open, verify, cache }
}

function persistentCacheByDefault(environment: NodeJS.ProcessEnv): boolean {
  const value = environment.CI?.trim().toLowerCase()
  return !value || value === '0' || value === 'false' || value === 'no' || value === 'off'
}

function usageError(): never {
  throw new Error(USAGE)
}
