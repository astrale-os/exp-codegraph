import type { ApiDiagnostic } from '../api/model.ts';
export type JsonSchemaValue = null | boolean | number | string | readonly JsonSchemaValue[] | {
    readonly [key: string]: JsonSchemaValue;
};
export interface EmitJsonSchemaOptions {
    readonly mainFile: string;
    readonly projectRoot?: string;
    readonly roots: readonly string[];
    readonly bundleId: string;
}
export interface JsonSchemaEmission {
    readonly ok: boolean;
    readonly schema?: JsonSchemaValue;
    readonly diagnostics: readonly ApiDiagnostic[];
}
/**
 * Generate one strict bundled wire schema from explicitly named exported declarations.
 *
 * The declaration API remains authoritative. JSON Schema is a deterministic generated artifact;
 * unsupported TypeScript constructs fail rather than being hidden or approximated.
 */
export declare function emitJsonSchema(options: EmitJsonSchemaOptions): Promise<JsonSchemaEmission>;
