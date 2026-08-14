import type { ApiCompilation } from '../api/model.ts'
import type { CompileApiOptions } from '../api/project.ts'

import { compileDeclarationApi, compileDeclarationApis } from '../api/project.ts'

export type { ApiCompilation, CompileApiOptions }

export async function compileApi(options: CompileApiOptions): Promise<ApiCompilation> {
  return compileDeclarationApi(options)
}

export async function compileApis(
  options: readonly CompileApiOptions[],
): Promise<readonly ApiCompilation[]> {
  return compileDeclarationApis(options)
}
