import ts from 'typescript';
export type ExternalReferenceKind = 'module' | 'import' | 'type' | 'heritage' | 'member' | 'callable-member' | 'value';
/** One syntax-derived dependency identity. Third-party declaration source is never inspected. */
export interface ExternalReference {
    readonly specifier: string;
    readonly path: readonly string[];
    readonly kind: ExternalReferenceKind;
    readonly arity: number;
}
/**
 * Project only the external identities an authored declaration names.
 *
 * This is intentionally syntax-directed: compiling an API must not parse, normalize, or depend on
 * the internal declaration graph of Zod (or any other installed package). A named import may itself
 * be a namespace export, so qualified use such as `z.ZodType` determines that topology locally.
 */
export declare function collectExternalReferences(source: ts.SourceFile): readonly ExternalReference[];
/** Merge entrypoint projections into one virtual module source per package specifier. */
export declare function renderExternalModules(groups: readonly (readonly ExternalReference[])[]): ReadonlyMap<string, string>;
export declare function isExternalSpecifier(specifier: string): boolean;
