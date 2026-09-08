import type { AnalysisTelemetrySink } from '../../analysis/index.ts';
import type { CodegraphApplicationSessionOptions } from '../analysis/index.ts';
import type { TypeSpecApplicationService } from '../index.ts';
import { type PortableNodeApplicationCheckpoint } from './checkpoint.ts';
export interface NodeTypeSpecApplicationOptions {
    readonly root: string;
    readonly cacheDirectory: string;
    readonly persistence?: 'advisory' | 'memory';
    readonly repository?: string;
    readonly maximumRetainedSnapshots?: number;
    readonly maximumRetainedGenerations?: number;
    readonly telemetry?: AnalysisTelemetrySink;
    readonly native?: CodegraphApplicationSessionOptions;
    /** Caller-owned portable store; the Node application never disposes it. */
    readonly portableCheckpoint?: PortableNodeApplicationCheckpoint;
}
/** Node-owned store/native composition around the portable headless application service. */
export declare function createNodeTypeSpecApplicationService(options: NodeTypeSpecApplicationOptions): Promise<TypeSpecApplicationService>;
export declare function nodeApplicationWorkspaceCheckpointDirectory(cacheDirectory: string, root: string): string;
export declare function nodeApplicationRepositoryKey(root: string): Promise<string>;
