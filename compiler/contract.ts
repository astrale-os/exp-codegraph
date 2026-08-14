import type { ApiCompilation, CompileApiOptions } from './compile.ts'

/** Replaceable execution boundary for canonical API declaration compilation. */
export interface ApiCompiler {
  compile(options: CompileApiOptions): Promise<ApiCompilation>
}

export interface ApiBatchCompiler {
  compileMany(options: readonly CompileApiOptions[]): Promise<readonly ApiCompilation[]>
}
