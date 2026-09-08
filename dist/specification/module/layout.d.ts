import type { Diagnostic } from '../../source/diagnostic.ts';
import type { LayoutEntry, LayoutIgnorePattern, LayoutObservation } from '../resource/index.ts';
export declare const DEFAULT_LAYOUT_IGNORE_PATTERNS: readonly ['**/.check-workspace.cjs', '**/__tests__/**', '**/tests/**', '**/*.test.*', '**/*.spec.*'];
export interface CompiledLayoutEntry extends LayoutEntry {
    readonly line: number;
    readonly column: number;
}
export interface LayoutCompilation {
    readonly entries: readonly CompiledLayoutEntry[];
    readonly exact: boolean;
    readonly ignore: readonly string[];
    readonly diagnostics: readonly Diagnostic[];
}
export interface LayoutConformance {
    readonly observation: LayoutObservation;
    readonly ignore: readonly LayoutIgnorePattern[];
    readonly diagnostics: readonly Diagnostic[];
}
/** Extract one closed literal path list without executing it. */
export declare function compileLayout(source: string, text: string): LayoutCompilation;
/** Compare sparse declared roots or one exact module root without following links. */
export declare function observeLayout(catalogRoot: string, moduleRoot: string, source: string, entries: readonly CompiledLayoutEntry[], options?: {
    readonly exact?: boolean;
    readonly ignore?: readonly string[];
}): Promise<LayoutConformance>;
