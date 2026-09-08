import type { Diagnostic } from '../source/diagnostic.ts';
import type { CliDiagnosticGroup } from './check-report.ts';
import type { ViewerQualification as Verification, ViewerQualificationProfile as VerificationProfile, ViewerQualificationRule as VerificationRule } from '../viewer-host/qualification.ts';
export interface CliOutput {
    out(message: string): void;
    error(message: string): void;
    /** Replace the current stdout line when attached to an interactive terminal. */
    update?(message: string): void;
    /** Clear an interactive progress line before ordinary output. */
    clear?(): void;
}
export declare function printDiagnostic(output: CliOutput, diagnostic: Diagnostic): void;
/** Present one exact source cause and a bounded account of its additional projections. */
export declare function printDiagnosticGroup(output: CliOutput, group: CliDiagnosticGroup): void;
export declare function printVerificationRule(output: CliOutput, source: string, rule: VerificationRule): void;
export declare function printVerificationProfile(output: CliOutput, source: string, profile: VerificationProfile): void;
/** Print a bounded, causal overview while retaining full evidence behind --details. */
export declare function printVerificationSummary(output: CliOutput, source: string, verification: Verification): void;
export declare function terminalText(value: string): string;
