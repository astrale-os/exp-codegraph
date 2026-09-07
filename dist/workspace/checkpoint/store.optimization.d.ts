/** Execute independent physical checkpoint work with one explicit concurrency ceiling. */
export declare function mapCheckpointWork<Input, Output>(values: readonly Input[], concurrency: number, operation: (value: Input) => Promise<Output>): Promise<readonly Output[]>;
