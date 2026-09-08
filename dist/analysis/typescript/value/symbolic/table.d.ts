type Leaf<Key, Value> = {
    readonly kind: 'leaf';
    readonly hash: number;
    readonly key: Key;
    readonly value: Value;
};
type Collision<Key, Value> = {
    readonly kind: 'collision';
    readonly hash: number;
    readonly values: ReadonlyMap<Key, Value>;
};
type Branch<Key, Value> = {
    readonly kind: 'branch';
    readonly children: ReadonlyMap<number, Node<Key, Value>>;
};
type Node<Key, Value> = Leaf<Key, Value> | Collision<Key, Value> | Branch<Key, Value>;
/** Immutable lookup tables share untouched hash-trie branches between pinned revisions. */
export declare class ValueIndexTable<Key extends string, Value> implements ReadonlyMap<Key, Value> {
    #private;
    readonly size: number;
    readonly [Symbol.toStringTag] = "ValueIndexTable";
    constructor(root?: Node<Key, Value>, size?: number);
    get(key: Key): Value | undefined;
    has(key: Key): boolean;
    edit(): ValueIndexTableEdit<Key, Value>;
    entries(): MapIterator<[Key, Value]>;
    keys(): MapIterator<Key>;
    values(): MapIterator<Value>;
    [Symbol.iterator](): MapIterator<[Key, Value]>;
    forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown): void;
}
/** One update copies each modified branch once, even when many facts share its prefix. */
export declare class ValueIndexTableEdit<Key extends string, Value> {
    #private;
    constructor(root: Node<Key, Value> | undefined, size: number);
    get(key: Key): Value | undefined;
    set(key: Key, value: Value): void;
    delete(key: Key): void;
    finish(): ValueIndexTable<Key, Value>;
    private branch;
    private write;
    private remove;
}
export {};
