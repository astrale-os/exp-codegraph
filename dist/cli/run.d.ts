import type { TypeSpecApplicationReader, TypeSpecApplicationService, TypeSpecApplicationSnapshot } from '../application/index.ts';
import type { RunningDevServer } from '../server/start.ts';
import type { DevOptions } from '../server/start.ts';
import type { Diagnostic } from '../source/diagnostic.ts';
import type { ChangedSpecificationScope } from './changes.ts';
import type { CliAccelerationReceipt } from './acceleration.ts';
import type { EvidenceTestPlan, EvidenceTestResult } from './evidence.ts';
import type { CliCommand } from './parse.ts';
import type { CliOutput } from './report.ts';
import type { ApplicationCheckpointReference } from '../application/checkpoint/index.ts';
import type { FileWorkspaceCheckpointStore } from '../workspace/checkpoint/index.ts';
import { type CliCheckCatalog } from './semantic-pack/model.ts';
export type { CliCheckCatalog, CliCheckCatalogSpecification, } from './semantic-pack/model.ts';
export interface CliServices {
    version(): Promise<string>;
    initializeModule(root: string): Promise<string>;
    createApplication(root: string, cache: boolean, portableCheckpoint?: CliPortableCheckpoint): Promise<TypeSpecApplicationService>;
    startDev(options: Extract<CliCommand, {
        name: 'dev';
    }> & Pick<DevOptions, 'telemetry'>): Promise<RunningDevServer>;
    changedSpecificationScope(root: string, base?: string): Promise<ChangedSpecificationScope>;
    planEvidenceTests(root: string, reader: TypeSpecApplicationReader, scope: 'all' | 'selected' | 'changed'): Promise<EvidenceTestPlan>;
    executeEvidenceTests(root: string, plan: EvidenceTestPlan, onGroup?: (group: EvidenceTestPlan['groups'][number]) => void): Promise<EvidenceTestResult>;
}
export interface CliPortableCheckpoint {
    readonly store: FileWorkspaceCheckpointStore;
    readonly sourceProof: string;
    readonly writable: boolean;
    readonly reference?: ApplicationCheckpointReference;
}
export interface CliResult {
    readonly exitCode: number;
    readonly server?: RunningDevServer;
    /** Advisory acceleration evidence; excluded from terminal transcript and semantic result. */
    readonly acceleration?: CliAccelerationReceipt;
    readonly check?: {
        readonly repository: string;
        readonly inventory: string;
        readonly snapshot: string;
        readonly catalog?: CliCheckCatalog;
    };
}
export declare function runCommand(command: CliCommand, services: CliServices, output: CliOutput, portableCheckpoint?: CliPortableCheckpoint): Promise<CliResult>;
export declare function reportCheckResult(output: CliOutput, command: Extract<CliCommand, {
    readonly name: 'check';
}>, snapshot: Pick<TypeSpecApplicationSnapshot, 'id' | 'repository' | 'inventory' | 'selection' | 'specifications' | 'qualifications' | 'diagnostics'>, options?: {
    readonly catalog?: CliCheckCatalog;
}): CliResult;
export declare function reportProjectedCheckResult(output: CliOutput, command: Extract<CliCommand, {
    readonly name: 'check';
}>, snapshot: Pick<TypeSpecApplicationSnapshot, 'id' | 'repository' | 'inventory' | 'selection' | 'specifications'>, diagnostics: readonly Diagnostic[], qualificationFailed: boolean): CliResult;
