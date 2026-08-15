import { randomUUID } from 'node:crypto';
export class SQLiteLeaseRegistry {
    #owned = new Set();
    #timers = new Map();
    #database;
    #storeNamespace;
    #timeoutMs;
    #disposed = false;
    constructor(database, storeNamespace, timeoutMs) {
        this.#database = database;
        this.#storeNamespace = storeNamespace;
        this.#timeoutMs = timeoutMs;
    }
    insert(generation) {
        this.assertOpen();
        const lease = randomUUID();
        this.#database
            .prepare(`INSERT INTO analysis_leases
          (store_namespace, lease_id, universe, generation_sequence, expires_at)
         VALUES (?, ?, ?, ?, ?)`)
            .run(this.#storeNamespace, lease, generation.universe, generation.sequence, Date.now() + this.#timeoutMs);
        this.#owned.add(lease);
        return lease;
    }
    start(lease) {
        this.assertOpen();
        const timer = setInterval(() => {
            if (this.#disposed || !this.#owned.has(lease))
                return;
            try {
                this.#database
                    .prepare(`UPDATE analysis_leases
             SET expires_at = ?
             WHERE store_namespace = ? AND lease_id = ?`)
                    .run(Date.now() + this.#timeoutMs, this.#storeNamespace, lease);
            }
            catch {
                // A bounded writer may briefly own SQLite. Renewal retries three
                // times per lease window.
            }
        }, Math.max(250, Math.floor(this.#timeoutMs / 3)));
        timer.unref();
        this.#timers.set(lease, timer);
    }
    release(lease) {
        const timer = this.#timers.get(lease);
        if (timer)
            clearInterval(timer);
        this.#timers.delete(lease);
        this.#owned.delete(lease);
        if (this.#disposed)
            return;
        this.#database
            .prepare('DELETE FROM analysis_leases WHERE store_namespace = ? AND lease_id = ?')
            .run(this.#storeNamespace, lease);
    }
    dispose() {
        if (this.#disposed)
            return;
        for (const timer of this.#timers.values())
            clearInterval(timer);
        this.#timers.clear();
        const remove = this.#database.prepare('DELETE FROM analysis_leases WHERE store_namespace = ? AND lease_id = ?');
        for (const lease of this.#owned)
            remove.run(this.#storeNamespace, lease);
        this.#owned.clear();
        this.#disposed = true;
    }
    assertOpen() {
        if (this.#disposed)
            throw new Error('SQLite lease registry is disposed.');
    }
}
//# sourceMappingURL=leases.js.map