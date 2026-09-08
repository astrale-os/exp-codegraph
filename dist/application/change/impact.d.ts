import type { SpecificationSnapshot } from '../../specification/index.ts';
import type { SpecificationChangeOptions, SpecificationImpact, SpecificationImpactIndex } from './model.ts';
/**
 * Build a pure reverse index over one immutable specification corpus.
 *
 * The index stores only portable paths and owner source identities. It does not read the
 * repository, inspect the file system, or mutate the supplied snapshots.
 */
export declare function createSpecificationImpactIndex(specifications: readonly SpecificationSnapshot[]): SpecificationImpactIndex;
/** Resolve one path directly against a corpus without retaining an index. */
export declare function computeSpecificationImpact(specifications: readonly SpecificationSnapshot[], path: string, options?: SpecificationChangeOptions): SpecificationImpact;
/** Resolve one path against an existing index. */
export declare function findSpecificationImpact(index: SpecificationImpactIndex | readonly SpecificationSnapshot[], path: string, options?: SpecificationChangeOptions): SpecificationImpact;
/**
 * Validate an already-root-relative POSIX repository path.
 *
 * No normalization is performed: a caller that supplies `./file`, `a/../file`, a backslash,
 * an empty segment, or an absolute path receives an error instead of a silently reinterpreted
 * query.
 */
export declare function assertCanonicalRepositoryPath(path: string): string;
