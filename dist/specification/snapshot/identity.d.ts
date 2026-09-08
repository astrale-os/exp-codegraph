import type { SpecificationSnapshot, SpecificationSnapshotId } from './model.ts';
/** Deterministic identity namespace for one module inside a specification anchor. */
export declare function specificationModuleId(source: string, declarationPointer: string): string;
/** Bind normative snapshot meaning while reducing repeated declaration presentation payloads. */
export declare function specificationSnapshotIdentity(snapshot: Omit<SpecificationSnapshot, 'id'>): SpecificationSnapshotId;
