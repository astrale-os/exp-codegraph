import { LineCounter, type Document } from 'yaml';
import { type Diagnostic } from './diagnostic.ts';
export interface YamlSource {
    text: string;
    data: unknown;
    diagnostics: Diagnostic[];
    document?: Document;
    lines?: LineCounter;
}
export declare function loadYaml(file: string, source: string): Promise<YamlSource>;
export declare function sourcePosition(document: Document, lines: LineCounter, pointer: string): {
    line: number;
    column: number;
};
