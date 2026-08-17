import { basename } from 'node:path';
/** Generated, dependency, and VCS trees excluded from one application-owned repository inventory. */
export const APPLICATION_REPOSITORY_EXCLUDES = Object.freeze([
    '.git/**',
    'node_modules/**',
    '**/node_modules/**',
    'dist/**',
    '**/dist/**',
    'coverage/**',
    '**/coverage/**',
    '.cache/**',
    '**/.cache/**',
    '.pnpm-store/**',
    '**/.pnpm-store/**',
    'evidence/artifacts/**',
    '**/evidence/artifacts/**',
    'benchmark/artifacts/**',
    '**/benchmark/artifacts/**',
]);
/** Exact normalized repository scope shared by application refresh and restart admission. */
export function applicationRepositoryExcludes(root, exclude) {
    const rootName = basename(root);
    const scopedArtifacts = rootName === 'evidence' || rootName === 'benchmark' ? ['artifacts'] : [];
    return [...new Set([...APPLICATION_REPOSITORY_EXCLUDES, ...scopedArtifacts, ...exclude])].sort((left, right) => left.localeCompare(right));
}
//# sourceMappingURL=scope.js.map