export interface LocatedResource {
    readonly absolute: string;
    readonly source: string;
}
export declare function locateResource(root: string, containingFile: string, reference: string, suffix: string): Promise<LocatedResource>;
