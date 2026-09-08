import type { QualificationSnapshot, QualifySpecificationOptions, QualifySpecificationsOptions } from './model.ts';
import type { AnalysisSnapshotSet } from '../analysis/index.ts';
import type { SpecificationSnapshot } from '../specification/index.ts';
/** Compare one immutable specification with one exact, generation-pinned analysis snapshot set. */
export declare function qualifySpecification(options: QualifySpecificationOptions): Promise<QualificationSnapshot>;
/** Qualify one corpus while leasing every pinned universe and capability view exactly once. */
export declare function qualifySpecifications(options: QualifySpecificationsOptions): Promise<readonly QualificationSnapshot[]>;
/**
 * Bind already-proven specification-local profile results to a newer exact analysis snapshot.
 * The caller owns the proof that every profile input is unchanged; universe-scoped profiles must
 * never use this helper after a generation change.
 */
export declare function rebindQualificationSnapshot(qualification: QualificationSnapshot, specification: SpecificationSnapshot, analysis: AnalysisSnapshotSet): QualificationSnapshot;
