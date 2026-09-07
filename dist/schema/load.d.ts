import { type ValidateFunction } from 'ajv/dist/2020.js';
import { type Diagnostic } from '../source/diagnostic.ts';
export interface SchemaSource {
    text: string;
    schema: unknown;
    validate?: ValidateFunction;
    diagnostics: Diagnostic[];
}
export interface SchemaLoadOptions {
    /** Compile the schema into an instance validator. Defaults to true. */
    readonly compile?: boolean;
}
export declare function loadSchema(file: string, source: string, root: string, additionalSchemas?: readonly object[], options?: SchemaLoadOptions): Promise<SchemaSource>;
