import type { PolicyEvaluation, PolicyRunOptions } from './model.ts';
/** Evaluate installed policy code over one immutable pinned query without a store or commit port. */
export declare function runAnalysisPolicies(options: PolicyRunOptions): Promise<PolicyEvaluation>;
