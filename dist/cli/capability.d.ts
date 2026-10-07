import type { TypeSpecApplicationReader } from '../application/index.ts';
import type { CapabilityCoordinate, CapabilityStatus, DerivedCapability } from '../specification/index.ts';
export interface CliCapabilityStatus extends CapabilityCoordinate {
    readonly source: string;
    readonly status: CapabilityStatus;
    /** Present only when partial: what keeps the capability from being held. */
    readonly blocking?: DerivedCapability['blocking'];
}
export interface CliCapabilityReport {
    readonly declared: number;
    readonly partial: number;
    readonly held: number;
    readonly entries: readonly CliCapabilityStatus[];
}
/** Derive the status of every checked capability from citations and attached active tests. */
export declare function capabilityReport(reader: TypeSpecApplicationReader): Promise<CliCapabilityReport>;
/** One stable line; a scope without capabilities stays silent. */
export declare function capabilitySummary(report: CliCapabilityReport): string | undefined;
