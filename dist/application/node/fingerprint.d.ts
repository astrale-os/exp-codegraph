export interface CodegraphProducerFingerprintOptions {
    readonly packageRoot?: string;
    readonly mode?: 'source' | 'compiled' | 'auto';
    readonly persistence?: 'advisory' | 'memory';
}
/** Bind advisory checkpoints to the exact executable package tree, not only a release version. */
export declare function codegraphProducerFingerprint(input?: string | CodegraphProducerFingerprintOptions): Promise<string>;
