import type { SourceProofProvider, SourceScope } from '../../repository/index.ts';
export interface GitExecutable {
    run(root: string, args: readonly string[], signal?: AbortSignal, input?: Uint8Array): Promise<Buffer>;
}
/** Capture the installed Git executable behind one receiver-bound provider. */
export declare function createGitSourceProofProvider(): SourceProofProvider;
export declare function captureGitExecutable(): GitExecutable;
export declare function gitSourcePath(input: string): string;
export declare function gitSourcePathIncluded(path: string, scope: SourceScope): boolean;
