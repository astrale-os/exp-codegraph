import type { ConformanceRuleResult, QualificationProfileResult, QualificationSnapshot } from '../conformance/index.ts';
import type { Diagnostic } from '../source/diagnostic.ts';
import type { CliOutput } from './report.ts';
export declare function qualificationDiagnostics(qualification: QualificationSnapshot): readonly Diagnostic[];
export declare function printQualificationProfile(output: CliOutput, source: string, profile: QualificationProfileResult): void;
export declare function printQualificationRule(output: CliOutput, qualification: QualificationSnapshot, rule: ConformanceRuleResult): void;
/** Print one bounded failure overview while full rule evidence remains behind --details. */
export declare function printQualificationSummary(output: CliOutput, qualification: QualificationSnapshot): void;
