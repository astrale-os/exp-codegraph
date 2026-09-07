import type { ValidateFunction } from 'ajv';
import type { Document, LineCounter } from 'yaml';
import { type Diagnostic } from '../source/diagnostic.ts';
export declare function validateData(data: unknown, validate: ValidateFunction, file: string, document: Document, lines: LineCounter): Diagnostic[];
export declare function validateSchemaDocument(schema: unknown, file: string, diagnostics: Diagnostic[]): void;
