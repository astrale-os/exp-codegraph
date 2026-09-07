import type { Diagnostic } from '../source/diagnostic.ts';
export interface SchemaFileValidationOptions {
    readonly schema: string;
    readonly document: string;
    /** Closed root for local schema references. Defaults to the schema directory. */
    readonly root?: string;
}
/** Validate one bounded JSON or YAML document against one local Draft 2020-12 schema. */
export declare function validateSchemaFile(options: SchemaFileValidationOptions): Promise<readonly Diagnostic[]>;
