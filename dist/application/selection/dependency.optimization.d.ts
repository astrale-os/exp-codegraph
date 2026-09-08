import type { RepositoryInventory, RepositorySourceService } from '../../repository/index.ts';
import type { ApplicationDependencyOptimizationPlan, ApplicationSpecificationAnchor } from './model.ts';
export type { ApplicationDependencyOptimizationPlan } from './model.ts';
/**
 * Conservatively preplan authored specification imports before normative compilation.
 * Checker-derived snapshot references remain authoritative and repair every missed edge.
 */
export declare function planApplicationDependencyOptimization(root: string, anchors: readonly ApplicationSpecificationAnchor[], primary: readonly ApplicationSpecificationAnchor[], inventory: RepositoryInventory, sources: RepositorySourceService, signal?: AbortSignal): Promise<ApplicationDependencyOptimizationPlan>;
