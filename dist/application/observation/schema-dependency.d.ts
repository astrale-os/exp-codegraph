import type { SchemaResource } from '../../specification/index.ts';
/** One explicitly supplied schema-catalog input, independent of its checkout location. */
export interface ApplicationSchemaDependencyResource {
    readonly source: string;
    readonly revision: string;
    readonly schema: unknown;
    readonly resolutionBase: string;
}
/** Rebase one dependency catalog onto a portable virtual URI namespace. */
export declare function applicationSchemaDependencies(ordinal: number, schemas: readonly SchemaResource[]): readonly ApplicationSchemaDependencyResource[];
