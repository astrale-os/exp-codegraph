import type { ApiCompilation } from '../api/model.ts';
import type { CompileApiOptions } from '../api/project.ts';
export type { ApiCompilation, CompileApiOptions };
export declare function compileApi(options: CompileApiOptions): Promise<ApiCompilation>;
export declare function compileApis(options: readonly CompileApiOptions[]): Promise<readonly ApiCompilation[]>;
