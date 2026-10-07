import type { Diagnostic } from '../../source/diagnostic.ts';
import type { CapabilityResource, LawResource } from '../resource/index.ts';
export interface ModuleSemanticDeclarations {
    /** Catalog-relative POSIX module root; `.` names the catalog root. */
    readonly root: string;
    readonly source: string;
    readonly capabilities: readonly CapabilityResource[];
    readonly laws: readonly LawResource[];
}
/**
 * Load the capability and law descriptors of one specified module without compiling its contract.
 *
 * A directory without a direct `.spec/api.d.ts`, or one resolving outside the catalog, is not a
 * specified module.
 */
export declare function loadModuleSemanticDeclarations(catalogRoot: string, specDirectory: string): Promise<ModuleSemanticDeclarations | undefined>;
/**
 * Resolve every `{ module, id }` citation against the descriptors its descendant module declares.
 *
 * Resolution is syntactic: descendant descriptors are parsed, never imported or executed.
 */
export declare function resolveCapabilityReferences(catalogRoot: string, moduleRoot: string, capabilities: readonly CapabilityResource[]): Promise<readonly Diagnostic[]>;
