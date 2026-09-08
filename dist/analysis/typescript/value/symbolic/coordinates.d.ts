import type { FactId } from '../../../identity/index.ts';
import type { EvaluatedValueResult } from '../model.ts';
type Limits = EvaluatedValueResult<unknown>['limits'];
interface EvidenceToken {
    readonly id: number;
    readonly fact: FactId;
}
interface BudgetToken {
    readonly key: string;
    readonly limits: Limits;
}
export interface ProofCoordinates {
    readonly evidence: readonly EvidenceToken[];
    readonly budget: BudgetToken;
}
/** A vocabulary owned only by resident proof bases, without a history of rejected requests. */
export declare class ResidentProofCoordinates {
    #private;
    prepare(evidence: readonly FactId[], limits: Limits): ProofCoordinates;
    additionalBytes(coordinates: ProofCoordinates): number | undefined;
    retain(coordinates: ProofCoordinates): void;
    release(coordinates: ProofCoordinates): void;
    clear(): void;
    get bytes(): number;
}
export {};
