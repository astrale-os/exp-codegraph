import type { TypeSpecApplicationReader } from '../application/index.ts';
import type { SourceEditRequest, SourceEditResponse } from '../application/interaction/editing.ts';
import type { SpecRevealResponse } from '../application/interaction/reveal.ts';
/** Save only an authored source declared by the pinned application snapshot. */
export declare function saveApplicationSource(root: string, reader: TypeSpecApplicationReader, request: SourceEditRequest): Promise<SourceEditResponse>;
/** Reveal an exact application-owned specification anchor, never an arbitrary client path. */
export declare function revealApplicationSpecification(root: string, reader: TypeSpecApplicationReader, source: string, reveal?: (file: string, directory: string) => Promise<void>): Promise<SpecRevealResponse>;
