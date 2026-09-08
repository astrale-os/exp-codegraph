interface Node<Value> {
    readonly key: string;
    readonly value: Value;
    readonly left: Node<Value> | undefined;
    readonly right: Node<Value> | undefined;
    readonly height: number;
    readonly size: number;
}
/** Ordered snapshot data: updates share untouched branches and never retain a previous root. */
export declare class OrderedMap<Value> {
    #private;
    constructor(root?: Node<Value>);
    get size(): number;
    static fromSorted<Value>(entries: readonly (readonly [string, Value])[]): OrderedMap<Value>;
    get(key: string): Value | undefined;
    set(key: string, value: Value): OrderedMap<Value>;
    delete(key: string): OrderedMap<Value>;
    entries(): IterableIterator<readonly [string, Value]>;
    values(): IterableIterator<Value>;
    [Symbol.iterator](): IterableIterator<readonly [string, Value]>;
}
export declare function compareKeys(left: string, right: string): number;
export {};
