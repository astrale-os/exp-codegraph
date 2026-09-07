import type { Diagnostic } from '../../source/diagnostic.ts';
import type { HistoryResource } from '../resource/index.ts';
import type { ModuleFile } from './inventory.ts';
export interface HistoryResourceLoad {
    readonly resource?: HistoryResource;
    readonly diagnostics: readonly Diagnostic[];
}
/** Read history as inert content, retaining text only when it fits the normal editable-file bound. */
export declare function loadHistoryResource(file: ModuleFile): Promise<HistoryResourceLoad>;
