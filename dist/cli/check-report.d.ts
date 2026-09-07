import type { TypeSpecApplicationSelection } from '../application/index.ts';
import type { Diagnostic } from '../source/diagnostic.ts';
export declare const CLI_CHECK_REPORT_FORMAT = "astrale.codegraph.check-report";
export declare const CLI_CHECK_REPORT_VERSION = 1;
export type CliCheckOutputFormat = 'text' | 'json';
export interface CliDiagnosticGroup {
    readonly code: string;
    readonly message: string;
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly pointers: readonly (string | null)[];
}
export type CliCheckScope = {
    readonly kind: 'full';
    readonly specifications: readonly string[];
} | {
    readonly kind: 'focused';
    readonly requested: readonly string[];
    readonly selected: readonly string[];
    readonly support: readonly string[];
};
export interface CliCheckReport {
    readonly format: typeof CLI_CHECK_REPORT_FORMAT;
    readonly version: typeof CLI_CHECK_REPORT_VERSION;
    readonly command: 'check';
    readonly status: 'pass' | 'fail';
    readonly evidence: {
        readonly repository: string;
        readonly inventory: string;
        readonly snapshot: string;
    };
    readonly scope: CliCheckScope;
    readonly qualificationFailed: boolean;
    readonly diagnostics: readonly CliDiagnosticGroup[];
    readonly summary: {
        readonly specifications: number;
        readonly diagnosticCauses: number;
        readonly diagnosticOccurrences: number;
    };
}
/** Losslessly coalesce only projection variants of one exact source diagnostic cause. */
export declare function groupDiagnostics(values: readonly Diagnostic[]): readonly CliDiagnosticGroup[];
export declare function createCliCheckReport(input: {
    readonly repository: string;
    readonly inventory: string;
    readonly snapshot: string;
    readonly selection: TypeSpecApplicationSelection;
    readonly specificationSources: readonly string[];
    readonly diagnostics: readonly CliDiagnosticGroup[];
    readonly qualificationFailed: boolean;
}): CliCheckReport;
export declare function encodeCliCheckReport(report: CliCheckReport): string;
