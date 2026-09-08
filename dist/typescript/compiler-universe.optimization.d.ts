import ts from 'typescript';
/** Classify source that can change sibling meaning inside a shared TypeScript Program. */
export declare function typeScriptSourceHasAmbientEffects(source: ts.SourceFile): boolean;
