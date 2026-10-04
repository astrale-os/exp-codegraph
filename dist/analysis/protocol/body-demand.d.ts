import type { NativeBodyDemand } from './model.ts';
export declare function isBodyDemandPath(value: unknown): value is string;
/** Validate before publishing selection intent to a resident owner. */
export declare function captureBodyDemand(input: NativeBodyDemand): NativeBodyDemand;
