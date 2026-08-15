import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

/** Read the installed consumer package version without initializing analysis. */
export async function readCodegraphVersion(): Promise<string> {
  const candidate = resolve(import.meta.dirname, '..')
  const root = basename(candidate) === 'dist' ? dirname(candidate) : candidate
  const manifest: unknown = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    typeof (manifest as { readonly version?: unknown }).version !== 'string' ||
    !(manifest as { readonly version: string }).version.trim()
  ) {
    throw new Error('Installed @astrale-os/codegraph package has no version.')
  }
  return (manifest as { readonly version: string }).version
}
