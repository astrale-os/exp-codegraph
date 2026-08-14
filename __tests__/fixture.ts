import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface Fixture {
  root: string
  write(path: string, contents: string | Uint8Array): Promise<void>
  remove(): Promise<void>
}

export async function fixture(files: Record<string, string | Uint8Array>): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'astrale-spec-'))
  const write = async (path: string, contents: string | Uint8Array): Promise<void> => {
    const target = join(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents)
  }
  await Promise.all(Object.entries(files).map(([path, contents]) => write(path, contents)))
  return { root, write, remove: () => rm(root, { recursive: true, force: true }) }
}

export function schema(properties: Record<string, unknown> = { name: { type: 'string' } }): string {
  return JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: Object.keys(properties),
      properties,
    },
    null,
    2,
  )
}
