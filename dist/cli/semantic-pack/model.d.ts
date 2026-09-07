import type { ApplicationCheckpointReference } from '../../application/checkpoint/index.ts';
import type { QualificationSnapshot } from '../../conformance/index.ts';
import type { Diagnostic } from '../../source/diagnostic.ts';
import type { CliAccelerationEvent } from '../acceleration.ts';
export declare const CHECK_RESULT_FORMAT = "astrale.codegraph.cli-check-result";
export declare const CHECK_RESULT_VERSION = 3;
export declare const CHECK_RESULT_ARTIFACT = "cli/check-result.json.br";
export declare const CHECK_CATALOG_FORMAT = "astrale.codegraph.cli-check-catalog";
export declare const CHECK_CATALOG_VERSION = 1;
export declare const CHECK_CATALOG_ARTIFACT = "cli/check-catalog.json.br";
export declare const SEMANTIC_PACK_FORMAT = "astrale.codegraph.cli-check-pack";
export declare const SEMANTIC_PACK_VERSION = 2;
export declare const MAXIMUM_CHECK_RESULT_BYTES: number;
export declare const MAXIMUM_CHECK_CATALOG_BYTES: number;
export declare const CHECK_SEMANTIC_PLAN: Readonly<{
    format: 'astrale.codegraph.cli-check-semantic-plan';
    version: 1;
    requestedCapabilities: readonly never[];
    requestedProfiles: readonly string[];
    compilerAnalysis: false;
    schemaRoots: readonly never[];
}>;
export declare function isCheckSemanticPlan(value: unknown): boolean;
export interface CheckTranscriptEntry {
    readonly channel: 'stdout' | 'stderr';
    readonly message: string;
}
export interface StoredCheckResult {
    readonly format: typeof CHECK_RESULT_FORMAT;
    readonly version: typeof CHECK_RESULT_VERSION;
    readonly producerFingerprint: string;
    readonly sourceProof?: string;
    readonly request: string;
    readonly repository: string;
    readonly inventory: string;
    readonly snapshot: string;
    readonly exitCode: number;
    readonly transcript: readonly CheckTranscriptEntry[];
    readonly catalogStatus?: 'available' | 'encode-failed' | 'not-applicable' | 'publish-failed' | 'projected';
}
export interface CliCheckCatalogSpecification {
    readonly id: string;
    readonly source: string;
    readonly root: string;
    readonly sourceReferences: readonly {
        readonly target: {
            readonly source: string;
        };
    }[];
    readonly diagnostics: readonly Diagnostic[];
}
export interface CliCheckCatalog {
    readonly sharedDiagnostics: readonly Diagnostic[];
    readonly specifications: readonly CliCheckCatalogSpecification[];
    readonly qualifications: readonly {
        readonly id: string;
        readonly source: string;
        readonly status: QualificationSnapshot['status'];
        readonly diagnostics: readonly Diagnostic[];
    }[];
}
export interface StoredCheckCatalog {
    readonly format: typeof CHECK_CATALOG_FORMAT;
    readonly version: typeof CHECK_CATALOG_VERSION;
    readonly producerFingerprint: string;
    readonly sourceProof?: string;
    readonly family: string;
    readonly repository: string;
    readonly inventory: string;
    readonly snapshot: string;
    readonly catalog: CliCheckCatalog;
}
export interface SemanticPackLoad {
    readonly result?: StoredCheckResult;
    readonly catalog?: StoredCheckCatalog;
    readonly application?: ApplicationCheckpointReference;
    readonly event: CliAccelerationEvent;
}
export declare function isApplicationCheckpointReference(value: unknown): value is ApplicationCheckpointReference;
export declare function isStoredCheckResult(value: unknown): value is StoredCheckResult;
export declare function isStoredCheckCatalog(value: unknown): value is StoredCheckCatalog;
