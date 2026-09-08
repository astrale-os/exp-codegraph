import type { AnalysisStore, NativeModuleBoundary } from '../../analysis/index.ts';
import type { RepositoryInventory } from '../../repository/index.ts';
import type { SpecificationSnapshot } from '../../specification/index.ts';
import { type ApplicationObservationRefresh } from './model.ts';
import type { ApplicationSchemaDependencyResource } from './schema-dependency.ts';
export interface MaterializeApplicationObservationsOptions {
    readonly root: string;
    readonly store: AnalysisStore;
    readonly inventory: RepositoryInventory;
    readonly specifications: readonly SpecificationSnapshot[];
    /** Exact resolved implementation boundaries requested by compiler-backed verification. */
    readonly bindings?: readonly NativeModuleBoundary[];
    /** Specification sources whose owner-scoped observation shards must be recomputed. */
    readonly refresh?: readonly string[];
    readonly schemaDependencies?: readonly ApplicationSchemaDependencyResource[];
    readonly signal?: AbortSignal;
}
/** Materialize repository-scoped TypeSpec observations into one portable universe. */
export declare function materializeApplicationObservations(options: MaterializeApplicationObservationsOptions): Promise<ApplicationObservationRefresh>;
