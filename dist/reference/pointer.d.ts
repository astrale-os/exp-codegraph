export interface PointerResult {
    found: boolean;
    value?: unknown;
}
export declare function pointerSegments(pointer: string): string[];
export declare function pointerFromPath(path: readonly (string | number)[]): string;
export declare function readPointer(value: unknown, pointer: string): PointerResult;
