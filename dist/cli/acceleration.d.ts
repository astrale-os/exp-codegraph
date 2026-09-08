export type CliAccelerationOperation = 'source-proof' | 'semantic-pack-read' | 'semantic-pack-publish' | 'workspace-result-read' | 'workspace-result-publish' | 'catalog-read' | 'catalog-publish' | 'admission';
export interface CliAccelerationEvent {
    readonly operation: CliAccelerationOperation;
    readonly outcome: 'admitted' | 'hit' | 'miss' | 'published' | 'fallback' | 'failed';
    readonly code: string;
    readonly durationMs: number;
    readonly work?: {
        readonly bytesRead?: number;
        readonly bytesWritten?: number;
        readonly bytesDecoded?: number;
        readonly loadedShards?: number;
        readonly writtenShards?: number;
    };
    readonly error?: {
        readonly name: string;
        readonly message: string;
    };
}
/** Non-semantic evidence for every advisory acceleration decision in one command. */
export interface CliAccelerationReceipt {
    readonly format: 'astrale.codegraph.cli-acceleration-receipt';
    readonly version: 1;
    readonly events: readonly CliAccelerationEvent[];
}
export declare function createCliAccelerationReceipt(events: readonly CliAccelerationEvent[]): CliAccelerationReceipt;
export declare function cliAccelerationError(error: unknown): {
    readonly name: string;
    readonly message: string;
};
export declare function createCliAccelerationEvent(operation: CliAccelerationOperation, outcome: CliAccelerationEvent['outcome'], code: string, started: number, error?: unknown): CliAccelerationEvent;
