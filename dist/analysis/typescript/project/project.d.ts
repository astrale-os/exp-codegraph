import type { TypeScriptProject, TypeScriptProjectOptions } from './model.ts';
/** Open a headless project using the installed native analyzer and a caller-local memory store. */
export declare function openTypeScriptProject(options: TypeScriptProjectOptions): Promise<TypeScriptProject>;
