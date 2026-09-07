import type { Diagnostic } from '../../source/diagnostic.ts';
export interface ModuleFile {
    readonly absolute: string;
    /** POSIX path relative to `.spec/` or `.history/`. */
    readonly relative: string;
    /** POSIX path relative to the catalog root. */
    readonly source: string;
}
export interface ModuleFileInventory {
    readonly api: ModuleFile;
    readonly apiFragments: readonly ModuleFile[];
    readonly code?: ModuleFile;
    readonly icon?: ModuleFile;
    readonly internal?: ModuleFile;
    readonly schemas: readonly ModuleFile[];
    readonly ports: readonly ModuleFile[];
    readonly capabilities: readonly ModuleFile[];
    readonly flows: readonly ModuleFile[];
    readonly laws: readonly ModuleFile[];
    readonly states: readonly ModuleFile[];
    readonly limits?: ModuleFile;
    readonly layout?: ModuleFile;
    readonly examples: readonly ModuleFile[];
    readonly benchmarks: readonly ModuleFile[];
    readonly packages: readonly ModuleFile[];
    readonly packageExceptions?: ModuleFile;
    readonly architecture?: ModuleFile;
    readonly history: readonly ModuleFile[];
    readonly diagnostics: readonly Diagnostic[];
    readonly historyDiagnostics: readonly Diagnostic[];
}
/** Discover the closed normative `.spec/` grammar and the open sibling `.history/` tree. */
export declare function inventoryModuleFiles(catalogRoot: string, specDirectory: string): Promise<ModuleFileInventory>;
