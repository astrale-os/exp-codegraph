import type { SpecificationSnapshot } from './model.ts';
/** Compile only authored normative meaning; observation and qualification are separate consumers. */
export declare function compileSpecificationSnapshot(root: string, specDirectory: string): Promise<SpecificationSnapshot>;
