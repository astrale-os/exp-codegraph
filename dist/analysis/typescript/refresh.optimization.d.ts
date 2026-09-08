import type { FactTransaction } from '../generation/index.ts';
import type { NativeSourceChange } from '../protocol/index.ts';
import type { TypeScriptModuleRouting } from './model.ts';
/** Carry exact inventory evidence in stable order without changing the legacy path hint. */
export declare function orderedNativeSourceChanges(values: readonly NativeSourceChange[] | undefined): readonly NativeSourceChange[] | undefined;
/** Derive the exact owner projection changed by an incremental normalized-fact transaction. */
export declare function changedModuleSubjects(transaction: FactTransaction | undefined): readonly string[] | undefined;
/** Retain only the source/dependency evidence required for exact project routing. */
export declare function moduleRouting(transaction: FactTransaction | undefined): TypeScriptModuleRouting | undefined;
