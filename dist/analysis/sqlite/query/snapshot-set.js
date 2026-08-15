import { deriveAnalysisSnapshotSetId } from '../../query/index.js';
export class SQLiteSnapshotSet {
    id;
    inventory;
    universes;
    #generations;
    #openQuery;
    #release;
    #disposed = false;
    constructor(generations, inventory, openQuery, release) {
        this.#generations = generations;
        this.#openQuery = openQuery;
        this.#release = release;
        this.inventory = inventory;
        this.universes = [...generations.keys()].sort();
        this.id = deriveAnalysisSnapshotSetId(new Map(this.universes.map((universe) => [universe, generations.get(universe).id])), inventory);
    }
    query(universe) {
        if (this.#disposed)
            throw new Error('Analysis snapshot set is disposed.');
        const generation = this.#generations.get(universe);
        if (!generation)
            throw new Error(`Universe ${universe} is not in this snapshot set.`);
        return this.#openQuery(universe, generation.id);
    }
    async [Symbol.asyncDispose]() {
        await this.dispose();
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        await this.#release();
    }
}
//# sourceMappingURL=snapshot-set.js.map