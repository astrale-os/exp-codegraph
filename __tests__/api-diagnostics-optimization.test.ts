import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import ts from 'typescript'

import { declarationDiagnosticsForFiles } from '../api/diagnostics-universe.optimization.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('declaration diagnostics universe optimization', () => {
  it('preserves exact filtered TypeScript diagnostics and ordering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-declaration-diagnostics-'))
    temporary.push(root)
    const spec = join(root, '.spec')
    await mkdir(spec)
    const main = join(spec, 'api.d.ts')
    const dependency = join(spec, 'value.d.ts')
    await writeFile(
      main,
      "import type { Value } from './value.js'\nexport interface Api { value: Value; missing: Missing }\n",
    )
    await writeFile(dependency, 'export interface Value { readonly id: string }\n')
    const options = {
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      types: [],
    }
    const program = ts.createProgram({ rootNames: [main], options })
    const admitted = new Set([realpathSync(main), realpathSync(dependency)])
    const canonical = ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
      if (!diagnostic.file) return true
      try {
        return admitted.has(realpathSync(diagnostic.file.fileName))
      } catch {
        return false
      }
    })

    expect(declarationDiagnosticsForFiles(program, admitted)).toEqual(canonical)
  })
})
