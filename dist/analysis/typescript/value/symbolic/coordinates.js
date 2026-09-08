/** A vocabulary owned only by resident proof bases, without a history of rejected requests. */
export class ResidentProofCoordinates {
    #evidence = new Map();
    #budgets = new Map();
    #nextEvidence = 0;
    #bytes = 0;
    prepare(evidence, limits) {
        const key = `${limits.maximumDepth}/${limits.maximumSteps}/${limits.maximumAlternatives}`;
        const budget = this.#budgets.get(key)?.value ?? Object.freeze({ key, limits });
        const local = new Map();
        const tokens = evidence.map(fact => {
            let token = this.#evidence.get(fact)?.value ?? local.get(fact);
            if (!token) {
                token = Object.freeze({ id: ++this.#nextEvidence, fact });
                local.set(fact, token);
            }
            return token;
        });
        return Object.freeze({ evidence: Object.freeze(tokens), budget });
    }
    additionalBytes(coordinates) {
        const budget = this.#budgets.get(coordinates.budget.key);
        if (budget && budget.value !== coordinates.budget)
            return;
        let bytes = budget ? 0 : budgetBytes(coordinates.budget);
        for (const token of new Set(coordinates.evidence)) {
            // One oversized coordinate still bypasses caching, even when the aggregate
            // cache would have room. Do not turn interning into an unbounded admission.
            const size = evidenceBytes(token);
            if (size > 1024 * 1024)
                return;
            const current = this.#evidence.get(token.fact);
            // A previously evicted coordinate cannot stand for a newly admitted token.
            if (current && current.value !== token)
                return;
            if (!current)
                bytes += size;
        }
        return bytes;
    }
    retain(coordinates) {
        const budget = this.#budgets.get(coordinates.budget.key);
        if (budget)
            budget.uses++;
        else {
            const bytes = budgetBytes(coordinates.budget);
            this.#budgets.set(coordinates.budget.key, { value: coordinates.budget, bytes, uses: 1 });
            this.#bytes += bytes;
        }
        for (const token of new Set(coordinates.evidence)) {
            const previous = this.#evidence.get(token.fact);
            if (previous)
                previous.uses++;
            else {
                const bytes = evidenceBytes(token);
                this.#evidence.set(token.fact, { value: token, bytes, uses: 1 });
                this.#bytes += bytes;
            }
        }
    }
    release(coordinates) {
        const budget = this.#budgets.get(coordinates.budget.key);
        if (--budget.uses === 0) {
            this.#budgets.delete(coordinates.budget.key);
            this.#bytes -= budget.bytes;
        }
        for (const token of new Set(coordinates.evidence)) {
            const previous = this.#evidence.get(token.fact);
            if (--previous.uses === 0) {
                this.#evidence.delete(token.fact);
                this.#bytes -= previous.bytes;
            }
        }
    }
    clear() { this.#evidence.clear(); this.#budgets.clear(); this.#bytes = 0; }
    get bytes() { return this.#bytes; }
}
function evidenceBytes(token) { return 256 + token.fact.length * 2; }
function budgetBytes(token) { return 512 + token.key.length * 2; }
//# sourceMappingURL=coordinates.js.map