import type { CodeConfiguration } from '../../authoring/code.ts';
import type { Diagnostic } from '../../source/diagnostic.ts';
export interface CodeCompilation {
    readonly configuration?: CodeConfiguration;
    readonly diagnostics: readonly Diagnostic[];
}
/** Extract the deliberately small convention-profile code extension without executing it. */
export declare function compileCode(source: string, text: string): CodeCompilation;
