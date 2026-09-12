/** Immutable lookup tables share untouched hash-trie branches between pinned revisions. */
export class ValueIndexTable {
    #root;
    size;
    [Symbol.toStringTag] = 'ValueIndexTable';
    constructor(root, size = 0) { this.#root = root; this.size = size; }
    get(key) {
        if (!this.#root)
            return undefined;
        const hash = hashKey(key);
        let node = this.#root;
        let shift = 0;
        while (node?.kind === 'branch') {
            const bit = 1 << ((hash >>> shift) & 31);
            if (!(node.bitmap & bit))
                return undefined;
            node = node.children[position(node.bitmap, bit)];
            shift += 5;
        }
        return node?.kind === 'leaf' ? node.key === key ? node.value : undefined : node?.values.get(key);
    }
    has(key) {
        if (!this.#root)
            return false;
        const hash = hashKey(key);
        let node = this.#root;
        let shift = 0;
        while (node?.kind === 'branch') {
            const bit = 1 << ((hash >>> shift) & 31);
            if (!(node.bitmap & bit))
                return false;
            node = node.children[position(node.bitmap, bit)];
            shift += 5;
        }
        return node?.kind === 'leaf' ? node.key === key : node?.values.has(key) ?? false;
    }
    edit() { return new ValueIndexTableEdit(this.#root, this.size); }
    *entries() { yield* entries(this.#root); }
    *keys() { for (const [key] of this)
        yield key; }
    *values() { for (const [, value] of this)
        yield value; }
    [Symbol.iterator]() { return this.entries(); }
    forEach(callback, thisArg) {
        for (const [key, value] of this)
            callback.call(thisArg, value, key, this);
    }
}
/** Empty roots are built in one batch; existing roots copy each modified branch once. */
export class ValueIndexTableEdit {
    #root;
    #size;
    #initial;
    #owned = new WeakSet();
    #finished = false;
    constructor(root, size) {
        this.#root = root;
        this.#size = size;
        if (!root)
            this.#initial = new Map();
    }
    get(key) {
        if (this.#initial)
            return this.#initial.get(key)?.value;
        if (!this.#root)
            return undefined;
        const hash = hashKey(key);
        let node = this.#root;
        let shift = 0;
        while (node?.kind === 'branch') {
            const bit = 1 << ((hash >>> shift) & 31);
            if (!(node.bitmap & bit))
                return undefined;
            node = node.children[position(node.bitmap, bit)];
            shift += 5;
        }
        return node?.kind === 'leaf' ? node.key === key ? node.value : undefined : node?.values.get(key);
    }
    set(key, value) {
        if (this.#finished)
            throw new Error('Value index update is already published.');
        if (this.#initial) {
            this.#initial.set(key, { kind: 'leaf', hash: hashKey(key), key, value });
            this.#size = this.#initial.size;
            return;
        }
        this.#root = this.write(this.#root, hashKey(key), key, value, 0);
    }
    delete(key) {
        if (this.#finished)
            throw new Error('Value index update is already published.');
        if (this.#initial) {
            if (!this.#initial.has(key))
                return;
            // A surviving sibling keeps its branch's original position. Building only
            // the remaining Map entries would move that branch after newer siblings.
            this.materialize();
        }
        this.#root = this.remove(this.#root, hashKey(key), key, 0);
    }
    finish() {
        this.materialize();
        this.#finished = true;
        return new ValueIndexTable(this.#root, this.#size);
    }
    materialize() {
        const initial = this.#initial;
        if (!initial)
            return;
        const size = initial.size;
        if (size <= 1) {
            this.#root = initial.values().next().value;
            this.#initial = undefined;
            return;
        }
        const leaves = new Array(size);
        const next = new Uint32Array(size);
        let offset = 0;
        for (const leaf of initial.values()) {
            leaves[offset] = leaf;
            next[offset] = offset + 1;
            offset++;
            initial.delete(leaf.key);
        }
        this.#initial = undefined;
        // Stable linked partitions use one position per leaf, rather than keeping a
        // copied reference array at each trie level. Seven levels cover all 32 bits.
        const heads = new Uint32Array(7 * 32), tails = new Uint32Array(7 * 32);
        const collision = (head, hash) => {
            const values = new Map();
            for (let index = head; index !== size; index = next[index]) {
                const leaf = leaves[index];
                values.set(leaf.key, leaf.value);
                leaves[index] = undefined;
            }
            return { kind: 'collision', hash, values };
        };
        const build = (head, shift) => {
            const first = leaves[head];
            if (next[head] === size) {
                leaves[head] = undefined;
                return first;
            }
            // A bucket remaining after the high two bits contains only full-hash
            // collisions. Do not wrap JS shifts or index beyond the bounded scratch.
            if (shift >= 32)
                return collision(head, first.hash);
            const depth = shift / 5 * 32;
            let bitmap = 0, order = '', sameHash = true;
            for (let index = head; index !== size;) {
                const leaf = leaves[index], following = next[index];
                const part = (leaf.hash >>> shift) & 31, bit = 1 << part, slot = depth + part;
                if (bitmap & bit)
                    next[tails[slot]] = index;
                else {
                    bitmap |= bit;
                    order += String.fromCharCode(part);
                    heads[slot] = index;
                }
                tails[slot] = index;
                next[index] = size;
                if (leaf.hash !== first.hash)
                    sameHash = false;
                index = following;
            }
            if (sameHash)
                return collision(head, first.hash);
            const children = new Array(order.length);
            let child = 0;
            for (let part = 0; part < 32; part++) {
                if (bitmap & (1 << part))
                    children[child++] = build(heads[depth + part], shift + 5);
            }
            return { kind: 'branch', bitmap, children, order };
        };
        this.#root = build(0, 0);
    }
    branch(node) {
        if (this.#owned.has(node))
            return node;
        const branch = { kind: 'branch', bitmap: node.bitmap, children: node.children.slice(), order: node.order };
        this.#owned.add(branch);
        return branch;
    }
    write(node, hash, key, value, shift) {
        if (!node) {
            this.#size++;
            return { kind: 'leaf', hash, key, value };
        }
        if (node.kind === 'branch') {
            const part = (hash >>> shift) & 31;
            const bit = 1 << part;
            const branch = this.branch(node);
            const index = position(branch.bitmap, bit);
            if (branch.bitmap & bit)
                branch.children[index] = this.write(branch.children[index], hash, key, value, shift + 5);
            else {
                const child = this.write(undefined, hash, key, value, shift + 5);
                // concat allocates exactly one additional slot; growing a sparse branch
                // with splice otherwise reserves a much larger backing array in V8.
                const children = branch.children.concat(child);
                for (let offset = children.length - 1; offset > index; offset--)
                    children[offset] = children[offset - 1];
                children[index] = child;
                branch.children = children;
                branch.bitmap |= bit;
                branch.order += String.fromCharCode(part);
            }
            return branch;
        }
        if (node.kind === 'leaf' && node.key === key)
            return { kind: 'leaf', hash, key, value };
        if (node.hash === hash) {
            const values = node.kind === 'leaf' ? new Map([[node.key, node.value]]) : new Map(node.values);
            if (!values.has(key))
                this.#size++;
            values.set(key, value);
            return { kind: 'collision', hash, values };
        }
        const part = (node.hash >>> shift) & 31;
        const branch = { kind: 'branch', bitmap: 1 << part, children: [node], order: String.fromCharCode(part) };
        this.#owned.add(branch);
        return this.write(branch, hash, key, value, shift);
    }
    remove(node, hash, key, shift) {
        if (!node)
            return;
        if (node.kind === 'branch') {
            const part = (hash >>> shift) & 31;
            const bit = 1 << part;
            if (!(node.bitmap & bit))
                return node;
            const index = position(node.bitmap, bit);
            const previous = node.children[index];
            const next = this.remove(previous, hash, key, shift + 5);
            if (next === previous)
                return node;
            const branch = this.branch(node);
            if (next)
                branch.children[index] = next;
            else {
                branch.children.splice(index, 1);
                branch.bitmap &= ~bit;
                const ordinal = branch.order.indexOf(String.fromCharCode(part));
                branch.order = branch.order.slice(0, ordinal) + branch.order.slice(ordinal + 1);
            }
            if (!branch.children.length)
                return;
            if (branch.children.length === 1) {
                const only = branch.children[0];
                if (only.kind !== 'branch')
                    return only;
            }
            return branch;
        }
        if (node.kind === 'leaf') {
            if (node.key !== key)
                return node;
            this.#size--;
            return;
        }
        if (!node.values.has(key))
            return node;
        const values = new Map(node.values);
        values.delete(key);
        this.#size--;
        if (values.size === 1) {
            const [remaining, value] = values.entries().next().value;
            return { kind: 'leaf', hash: node.hash, key: remaining, value };
        }
        return { kind: 'collision', hash: node.hash, values };
    }
}
function* entries(node) {
    if (node?.kind === 'leaf')
        yield [node.key, node.value];
    else if (node?.kind === 'collision')
        yield* node.values;
    else if (node)
        for (let index = 0; index < node.order.length; index++)
            yield* entries(node.children[position(node.bitmap, 1 << node.order.charCodeAt(index))]);
}
function position(bitmap, bit) {
    let before = bitmap & (bit - 1);
    before -= (before >>> 1) & 0x55555555;
    before = (before & 0x33333333) + ((before >>> 2) & 0x33333333);
    return Math.imul((before + (before >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}
function hashKey(value) {
    // Analysis coordinates already contain a uniformly distributed SHA-256 suffix.
    // Rehashing every character at each lookup wasted most of the trie traversal time.
    // Full keys remain in leaves and collision buckets, so this never establishes identity.
    if (value.charCodeAt(value.length - 65) === 58) {
        let digest = 0;
        let index = value.length - 8;
        for (; index < value.length; index++) {
            const code = value.charCodeAt(index);
            const lower = code | 32;
            const digit = code >= 48 && code <= 57 ? code - 48 : lower >= 97 && lower <= 102 ? lower - 87 : -1;
            if (digit < 0)
                break;
            digest = (digest << 4) | digit;
        }
        if (index === value.length)
            return digest >>> 0;
        // Preserve routing and traversal for arbitrary strings, including the partial
        // or signed hexadecimal spellings accepted by the original parseInt path.
        const partial = Number.parseInt(value.slice(-8), 16);
        if (Number.isFinite(partial))
            return partial >>> 0;
    }
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++)
        hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
    return hash >>> 0;
}
//# sourceMappingURL=table.js.map