export declare const MAX_VALUE_DEPTH = 100;
export declare const MAX_VALUE_NODES = 10000;
export type ValueLimit = 'depth' | 'size';
export declare function valueLimit(value: unknown): ValueLimit | undefined;
