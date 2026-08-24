import { createHash } from 'node:crypto';
import { scanRepositoryDirectories } from './topology.optimization.js';
export { repositoryDirectoryExcluded } from '../../repository/model.js';
/** Digest every admitted directory path, including empty optional specification directories. */
export async function repositoryDirectoryTopologyFingerprint(root, exclude, signal) {
    const directories = await scanRepositoryDirectories(root, exclude, signal);
    return createHash('sha256').update(JSON.stringify(directories)).digest('hex');
}
//# sourceMappingURL=topology.js.map