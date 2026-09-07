import type { ObservationIssue, ObservedSurface, SourceLocation } from '../../analysis/typescript/surface/model.ts';
/**
 * A facade may rename or omit canonical exports, but it cannot establish a second declaration
 * authority. Every declaration it exposes must already be public through the canonical entrypoint.
 */
export declare function compareEntrypointFacade(canonical: ObservedSurface, facade: ObservedSurface, location: SourceLocation): readonly ObservationIssue[];
