import type { ValueResult } from './model.ts';
/**
 * Project observed values without strengthening incomplete evidence.
 * Exhaustive alternatives collapse only when their projections are equivalent.
 * The default equivalence is Object.is; object projections need an explicit comparator.
 *
 * This returns a value result, not an evaluation receipt: limits and reuse metadata
 * belong to the original proof and are never copied to the derived result.
 */
export declare function mapValueResult<Input, Output>(result: ValueResult<Input>, project: (value: Input) => Output, options?: {
    readonly equals?: (left: Output, right: Output) => boolean;
}): ValueResult<Output>;
