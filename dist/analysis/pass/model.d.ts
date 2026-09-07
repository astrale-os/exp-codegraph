import type { Completeness, Fact, FactShard } from '../facts/index.ts';
import type { AnalysisGeneration, FactTransaction, ProducerIdentity } from '../generation/index.ts';
import type { PassId } from '../identity/index.ts';
import type { AnalysisQuery } from '../query/index.ts';
export type PassRuntime = 'native-go' | 'portable-typescript';
export type PassScope = 'source' | 'project' | 'repository';
export interface FactSchemaReference {
    readonly namespace: string;
    readonly minimumVersion: number;
    readonly maximumVersion: number;
}
export interface PassManifest {
    readonly id: PassId;
    readonly version: string;
    readonly runtime: PassRuntime;
    readonly scope: PassScope;
    readonly providesCapabilities: readonly string[];
    readonly requiresCapabilities: readonly string[];
    readonly inputs: readonly FactSchemaReference[];
    readonly outputs: readonly {
        readonly namespace: string;
        readonly version: number;
    }[];
    readonly invalidatesOn: readonly string[];
    readonly limits: Readonly<Record<string, number | string | boolean>>;
    readonly mandatory: boolean;
}
export interface PortablePassContext {
    readonly generation: AnalysisGeneration;
    readonly query: AnalysisQuery;
    readonly signal?: AbortSignal;
}
export interface PassOutput {
    readonly completion: Completeness;
    readonly shards: readonly FactShard[];
    readonly diagnostics: readonly Fact[];
}
export interface PortablePass {
    readonly manifest: PassManifest & {
        readonly runtime: 'portable-typescript';
    };
    run(context: PortablePassContext): Promise<PassOutput>;
}
export interface PassPlan {
    readonly ordered: readonly PassManifest[];
    readonly capabilities: readonly string[];
}
export interface PassPlanningEnvironment {
    readonly availableCapabilities?: readonly string[];
    readonly availableSchemas?: readonly {
        readonly namespace: string;
        readonly version: number;
    }[];
}
export interface PortablePassRunOptions {
    readonly plan: PassPlan;
    readonly passes: readonly PortablePass[];
    readonly query: AnalysisQuery;
    /** Previously materialized portable shards that remain valid for this refresh. */
    readonly carriedShards?: readonly FactShard[];
    readonly producer: ProducerIdentity;
    readonly signal?: AbortSignal;
}
export interface PortablePassRunResult {
    readonly transaction?: FactTransaction;
    readonly executed: readonly PassId[];
    readonly unavailable: readonly PassId[];
    readonly diagnostics: readonly Fact[];
}
export declare class PassPlanError extends Error {
    readonly name = "PassPlanError";
    readonly code: 'PASS_CYCLE' | 'PASS_INPUT_MISSING' | 'PASS_SCHEMA_INCOMPATIBLE';
    constructor(code: 'PASS_CYCLE' | 'PASS_INPUT_MISSING' | 'PASS_SCHEMA_INCOMPATIBLE', message: string);
}
export declare function planPasses(manifests: readonly PassManifest[], requestedCapabilities: readonly string[], environment?: PassPlanningEnvironment): PassPlan;
