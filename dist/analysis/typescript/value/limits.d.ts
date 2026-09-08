import type { BoundedValueLimits } from './model.ts';
/** Governed default budget returned to callers as effective configuration. */
export declare const DEFAULT_BOUNDED_VALUE_LIMITS: Readonly<Required<BoundedValueLimits>>;
export declare function resolveBoundedValueLimits(input?: BoundedValueLimits): Readonly<Required<BoundedValueLimits>>;
