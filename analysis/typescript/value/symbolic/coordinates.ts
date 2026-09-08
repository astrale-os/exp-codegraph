import type { FactId } from '../../../identity/index.ts'
import type { EvaluatedValueResult } from '../model.ts'

type Limits = EvaluatedValueResult<unknown>['limits']
interface EvidenceToken { readonly id: number; readonly fact: FactId }
interface BudgetToken { readonly key: string; readonly limits: Limits }
export interface ProofCoordinates {
  readonly evidence: readonly EvidenceToken[]
  readonly budget: BudgetToken
}
interface Resident<Value> { readonly value: Value; readonly bytes: number; uses: number }

/** A vocabulary owned only by resident proof bases, without a history of rejected requests. */
export class ResidentProofCoordinates {
  readonly #evidence = new Map<FactId, Resident<EvidenceToken>>()
  readonly #budgets = new Map<string, Resident<BudgetToken>>()
  #nextEvidence = 0
  #bytes = 0

  prepare(evidence: readonly FactId[], limits: Limits): ProofCoordinates {
    const key = `${limits.maximumDepth}/${limits.maximumSteps}/${limits.maximumAlternatives}`
    const budget = this.#budgets.get(key)?.value ?? Object.freeze({ key, limits })
    const local = new Map<FactId, EvidenceToken>()
    const tokens = evidence.map(fact => {
      let token = this.#evidence.get(fact)?.value ?? local.get(fact)
      if (!token) { token = Object.freeze({ id: ++this.#nextEvidence, fact }); local.set(fact, token) }
      return token
    })
    return Object.freeze({ evidence: Object.freeze(tokens), budget })
  }

  additionalBytes(coordinates: ProofCoordinates): number | undefined {
    const budget = this.#budgets.get(coordinates.budget.key)
    if (budget && budget.value !== coordinates.budget) return
    let bytes = budget ? 0 : budgetBytes(coordinates.budget)
    for (const token of new Set(coordinates.evidence)) {
      // One oversized coordinate still bypasses caching, even when the aggregate
      // cache would have room. Do not turn interning into an unbounded admission.
      const size = evidenceBytes(token)
      if (size > 1024 * 1024) return
      const current = this.#evidence.get(token.fact)
      // A previously evicted coordinate cannot stand for a newly admitted token.
      if (current && current.value !== token) return
      if (!current) bytes += size
    }
    return bytes
  }

  retain(coordinates: ProofCoordinates): void {
    const budget = this.#budgets.get(coordinates.budget.key)
    if (budget) budget.uses++
    else {
      const bytes = budgetBytes(coordinates.budget)
      this.#budgets.set(coordinates.budget.key, { value: coordinates.budget, bytes, uses: 1 }); this.#bytes += bytes
    }
    for (const token of new Set(coordinates.evidence)) {
      const previous = this.#evidence.get(token.fact)
      if (previous) previous.uses++
      else {
        const bytes = evidenceBytes(token)
        this.#evidence.set(token.fact, { value: token, bytes, uses: 1 }); this.#bytes += bytes
      }
    }
  }

  release(coordinates: ProofCoordinates): void {
    const budget = this.#budgets.get(coordinates.budget.key)!
    if (--budget.uses === 0) { this.#budgets.delete(coordinates.budget.key); this.#bytes -= budget.bytes }
    for (const token of new Set(coordinates.evidence)) {
      const previous = this.#evidence.get(token.fact)!
      if (--previous.uses === 0) { this.#evidence.delete(token.fact); this.#bytes -= previous.bytes }
    }
  }

  clear(): void { this.#evidence.clear(); this.#budgets.clear(); this.#bytes = 0 }
  get bytes(): number { return this.#bytes }
}

function evidenceBytes(token: EvidenceToken): number { return 256 + token.fact.length * 2 }
function budgetBytes(token: BudgetToken): number { return 512 + token.key.length * 2 }
