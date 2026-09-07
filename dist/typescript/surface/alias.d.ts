import type { ObservationIssue, ObservedSurface, SourceLocation } from '../../analysis/typescript/surface/model.ts';
export declare function compareEntrypointAlias(canonical: ObservedSurface, alias: ObservedSurface, location: SourceLocation): readonly ObservationIssue[];
