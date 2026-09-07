import type { Diagnostic } from '../../source/diagnostic.ts';
import type { ModuleIconResource } from '../resource/index.ts';
import type { ModuleFile } from './inventory.ts';
export declare const MAX_MODULE_ICON_BYTES: number;
export interface ModuleIconLoad {
    readonly resource?: ModuleIconResource;
    readonly diagnostics: readonly Diagnostic[];
}
/** Read and admit one intentionally small, inert SVG icon without executing or forwarding markup. */
export declare function loadModuleIcon(file: ModuleFile): Promise<ModuleIconLoad>;
