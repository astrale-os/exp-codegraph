import type { AnalysisTelemetrySink, RepositoryId } from '../analysis/index.ts';
import type { ConformanceProfile } from '../conformance/index.ts';
import type { ApplicationAnalysisWorkspace } from './analysis/index.ts';
import type { ApplicationCheckpoint } from './checkpoint/index.ts';
import type { TypeSpecApplicationService } from './model.ts';
import { createRepositorySourceService, inventoryRepository, refreshRepositoryStatistics } from '../repository/index.ts';
import { compileSpecificationSnapshots } from '../specification/index.ts';
import { type ApplicationAnalysisWorkspaceOptions, type CodegraphApplicationSessionOptions } from './analysis/index.ts';
import { discoverSpecificationDirectories } from './discovery/index.ts';
export interface TypeSpecApplicationDependencies {
    readonly resolveRoot: (input: string) => Promise<string>;
    readonly discover: typeof discoverSpecificationDirectories;
    readonly compile: typeof compileSpecificationSnapshots;
    readonly inventory: typeof inventoryRepository;
    readonly sources: typeof createRepositorySourceService;
    readonly statistics: typeof refreshRepositoryStatistics;
    readonly analysis: ApplicationAnalysisWorkspace;
    readonly profiles: readonly ConformanceProfile[];
    readonly checkpoint?: ApplicationCheckpoint;
}
export interface TypeSpecApplicationOptions {
    readonly root: string;
    /** Portable repository key; required when the root package has no stable package name. */
    readonly repository?: string;
    readonly maximumRetainedSnapshots?: number;
    readonly telemetry?: AnalysisTelemetrySink;
    readonly analysis?: Omit<ApplicationAnalysisWorkspaceOptions, 'root' | 'repository' | 'sessions'>;
    readonly native?: CodegraphApplicationSessionOptions;
    /** Optional advisory process-independent application checkpoint. */
    readonly checkpoint?: ApplicationCheckpoint;
}
/** Assemble specification, exact analysis, and qualification without coupling them to a UI. */
export declare function createTypeSpecApplicationService(options: TypeSpecApplicationOptions): Promise<TypeSpecApplicationService>;
/** Internal injection seam used by qualification; ordinary consumers receive the governed defaults. */
export declare function createTypeSpecApplicationServiceWithDependencies(options: TypeSpecApplicationOptions, injected?: Partial<TypeSpecApplicationDependencies>): Promise<TypeSpecApplicationService>;
export declare function resolveApplicationRepositoryIdentity(root: string, explicit?: string): Promise<RepositoryId>;
