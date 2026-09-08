export { repositoryDirectoryExcluded } from '../../repository/model.ts';
/** Digest every admitted directory path, including empty optional specification directories. */
export declare function repositoryDirectoryTopologyFingerprint(root: string, exclude: readonly string[], signal?: AbortSignal): Promise<string>;
