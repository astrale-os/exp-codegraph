import type { ApiCompilation, CompileApiOptions } from './compile.ts'

import { compileApis } from './compile.ts'
import { apiCompilerWorkerResourceReport } from './isolation-work.optimization.ts'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))

let options: readonly CompileApiOptions[] | undefined
let result: readonly ApiCompilation[]
try {
  options = JSON.parse(Buffer.concat(chunks).toString('utf8')) as readonly CompileApiOptions[]
  result = await compileApis(options)
} catch (error) {
  const failure: ApiCompilation = {
    ok: false,
    diagnostics: [
      {
        source: 'isolation',
        code: 'isolation/request-invalid',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
  }
  result = Array.from({ length: options?.length ?? 1 }, () => failure)
}

for (const compilation of result) process.stdout.write(`${JSON.stringify(compilation)}\n`)
process.stderr.write(`${apiCompilerWorkerResourceReport()}\n`)
