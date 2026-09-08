import type { SpecificationSnapshot } from '../../specification/index.ts';
import type { ApplicationCheckpointExpectation } from './model.ts';
export interface ApplicationCheckpointProjectionOwner {
    readonly source: string;
    readonly root: string;
    readonly dependencies: readonly string[];
}
/** Resolve a manifest-owned focused selection and its exact support closure without decoding owners. */
export declare function projectedApplicationCheckpointSources(owners: readonly ApplicationCheckpointProjectionOwner[], projection: NonNullable<ApplicationCheckpointExpectation['projection']>): ReadonlySet<string>;
/** Retain only dependency coordinates that are owned by the published corpus. */
export declare function applicationCheckpointSpecificationDependencies(specification: SpecificationSnapshot, corpusSources: ReadonlySet<string>): readonly string[];
