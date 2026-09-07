import type { SpecificationSnapshot } from '../../specification/index.ts';
import { compileSpecificationSnapshots } from '../../specification/index.ts';
import type { RepositoryInventory, RepositorySourceService } from '../../repository/index.ts';
import type { ApplicationSpecificationAnchor } from './model.ts';
import { type ApplicationDependencyOptimizationPlan } from './dependency.optimization.ts';
export interface RequestedSpecificationCompilation {
    readonly specifications: readonly SpecificationSnapshot[];
    readonly dependencyPlan: ApplicationDependencyOptimizationPlan;
    readonly primaryOwners: number;
    readonly waves: number;
    readonly fallbackOwners: number;
    readonly fallbackSources: readonly string[];
    readonly planningMilliseconds: number;
}
/** Compile a focused owner set and its exact authored declaration/support closure in bounded waves. */
export declare function compileRequestedSpecificationClosure(root: string, anchors: readonly ApplicationSpecificationAnchor[], select: readonly string[], inventory: RepositoryInventory, sources: RepositorySourceService, compile: typeof compileSpecificationSnapshots, signal?: AbortSignal): Promise<RequestedSpecificationCompilation>;
