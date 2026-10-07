import type { SemanticReference } from '../authoring/reference.ts';
import type { CapabilityResource } from './resource/index.ts';
export type CapabilityStatus = 'declared' | 'partial' | 'held';
/** One semantic identifier addressed by its catalog-relative module root. */
export interface CapabilityCoordinate {
    readonly module: string;
    readonly id: string;
}
export interface CapabilityDerivationModule {
    /** Catalog-relative POSIX module root; `.` names the catalog root. */
    readonly root: string;
    readonly capabilities: readonly CapabilityResource[];
    /** Declared laws, each with whether at least one active test declaration is attached. */
    readonly laws: readonly {
        readonly id: string;
        readonly active: boolean;
    }[];
}
export interface DerivedCapability extends CapabilityCoordinate {
    readonly source: string;
    readonly status: CapabilityStatus;
    /** Cited laws without an active test and cited capabilities that are not held. */
    readonly blocking: {
        readonly laws: readonly CapabilityCoordinate[];
        readonly capabilities: readonly CapabilityCoordinate[];
    };
}
/** Whether an authored module coordinate can only name a strict descendant of its citing module. */
export declare function isDescendantModulePath(value: string): boolean;
/** Catalog-relative root of the descendant module cited from one module root. */
export declare function descendantModuleRoot(root: string, module: string): string;
/** Stable identity of one authored reference inside its citing module. */
export declare function semanticReferenceKey(reference: SemanticReference): string;
/** Public-contract anchors of every descendant module cited by one module's capabilities. */
export declare function capabilityReferenceSources(specification: {
    readonly root: string;
    readonly capabilities: readonly CapabilityResource[];
}): readonly string[];
export interface CapabilityCitation extends CapabilityCoordinate {
    readonly source: string;
    /** The cited laws and capabilities through which this capability reaches the given laws. */
    readonly cites: {
        readonly laws: readonly CapabilityCoordinate[];
        readonly capabilities: readonly CapabilityCoordinate[];
    };
}
/** Capabilities that cite any of the given laws, directly or through other capabilities. */
export declare function capabilitiesCiting(modules: readonly Pick<CapabilityDerivationModule, 'root' | 'capabilities'>[], laws: readonly CapabilityCoordinate[]): readonly CapabilityCitation[];
/**
 * Derive every capability status from authored citations and attached active tests.
 *
 * A capability that cites nothing is declared. It is held when every cited law has an active
 * attached test and every cited capability is held; anything else, including an unresolved
 * citation or a citation cycle, is partial. The status is reported and is never a diagnostic.
 */
export declare function deriveCapabilityStatuses(modules: readonly CapabilityDerivationModule[]): readonly DerivedCapability[];
