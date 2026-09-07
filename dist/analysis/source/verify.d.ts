import type { SourceTextExpectation, SourceTextReader, VerifiedSourceText } from './model.ts';
/** Read source only through an explicit service and prove its generation digest before display. */
export declare function readVerifiedSourceText(expectation: SourceTextExpectation, reader: SourceTextReader, options?: {
    readonly signal?: AbortSignal;
}): Promise<VerifiedSourceText>;
