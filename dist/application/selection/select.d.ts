import type { SpecificationSnapshot } from '../../specification/index.ts';
import type { SelectApplicationSpecificationsOptions, ApplicationSpecificationAnchor, PlannedApplicationSpecificationAnchors, SelectedApplicationSpecifications } from './model.ts';
export declare function applicationSpecificationAnchors(root: string, directories: readonly string[]): readonly ApplicationSpecificationAnchor[];
export declare function planApplicationSpecificationAnchors(root: string, anchors: readonly ApplicationSpecificationAnchor[], select: readonly string[]): PlannedApplicationSpecificationAnchors;
/** Select requested owners, optional dependents, and their normative dependency closure. */
export declare function selectApplicationSpecifications(root: string, specifications: readonly SpecificationSnapshot[], options?: SelectApplicationSpecificationsOptions): SelectedApplicationSpecifications;
/** Normalize authored selection arguments once at the application boundary. */
export declare function normalizeApplicationSelectionTargets(root: string, inputs: readonly string[]): readonly string[];
/** Match one normalized target against portable owner coordinates. */
export declare function applicationSelectionOwners<Owner extends {
    readonly source: string;
    readonly root: string;
}>(specifications: readonly Owner[], target: string): Owner[];
