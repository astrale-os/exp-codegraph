import type { ApiModelV2, ApiSource, ApiToken } from '../../api/model.ts';
import type { SpecificationModuleSnapshot, SpecificationSnapshot } from '../../specification/index.ts';
import type { DeclarationResource, PortResource } from '../../specification/resource/index.ts';
type SpecificationDeclarationResource = DeclarationResource<ApiModelV2>;
type SpecificationPortResource = PortResource<ApiModelV2>;
/** One deduplicated declaration source and all tokens attributed to that source. */
export interface PackedApiPayload {
    readonly source: ApiSource;
    readonly tokens: readonly ApiToken[];
}
/** Caller-owned content-addressed payload table shared by packed snapshots. */
export type ApiPayloadStore = Map<string, PackedApiPayload>;
/** ApiModelV2 with source bodies/tokens moved to the shared payload table. */
export interface PackedApiModelV2 extends Omit<ApiModelV2, 'sources' | 'tokens'> {
    readonly sourceKeys: readonly string[];
    /** One source index per token when the original order was interleaved. */
    readonly tokenSourceIndexes?: readonly number[];
}
type PackedDeclarationResource = Omit<SpecificationDeclarationResource, 'model'> & {
    readonly model?: PackedApiModelV2;
};
type PackedPortResource = Omit<SpecificationPortResource, 'model'> & {
    readonly model?: PackedApiModelV2;
};
export interface PackedSpecificationModuleSnapshot extends Omit<SpecificationModuleSnapshot, 'api' | 'internal' | 'ports'> {
    readonly api?: PackedDeclarationResource;
    readonly internal?: PackedDeclarationResource;
    readonly ports: readonly PackedPortResource[];
}
export type PackedSpecificationSnapshot = Omit<SpecificationSnapshot, 'module'> & {
    readonly module: PackedSpecificationModuleSnapshot;
};
/**
 * Replace every API model in a specification module with content-addressed payload references.
 *
 * The supplied map is deliberately shared by the caller: packing several snapshots into the
 * same map deduplicates identical `{ source, tokens }` payloads across API, internal, and port
 * models without making the snapshot codec depend on a storage implementation.
 */
export declare function packSpecificationSnapshot(snapshot: SpecificationSnapshot, payloads: ApiPayloadStore): PackedSpecificationSnapshot;
/** Restore all API models from their shared payload references. */
export declare function unpackSpecificationSnapshot(packed: PackedSpecificationSnapshot, payloads: ReadonlyMap<string, PackedApiPayload>): SpecificationSnapshot;
export {};
