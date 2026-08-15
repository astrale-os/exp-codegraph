import { portablePath } from '../../analysis/identity/index.js';
/**
 * Build one deterministic, single-owner grouping from nested repository roots.
 * The deepest matching root wins, so a child module does not inflate its parent.
 */
export function createRepositoryPathOwnershipGrouping(id, owners) {
    if (!id.trim())
        throw new Error('Repository statistics grouping id must not be empty.');
    const normalized = owners.map((owner) => ({
        ...owner,
        root: normalizeRoot(owner.root),
    }));
    const roots = new Set();
    for (const owner of normalized) {
        if (!owner.key.trim())
            throw new Error('Repository statistics owner key must not be empty.');
        if (roots.has(owner.root)) {
            throw new Error(`Repository statistics ownership root is ambiguous: ${owner.root}.`);
        }
        roots.add(owner.root);
    }
    normalized.sort((left, right) => depth(right.root) - depth(left.root) ||
        left.root.localeCompare(right.root) ||
        left.key.localeCompare(right.key));
    return {
        id,
        values(file) {
            const owner = normalized.find((candidate) => owns(candidate.root, file.path));
            return owner
                ? [{ key: owner.key, ...(owner.label ? { label: owner.label } : {}) }]
                : [{ key: 'unassigned' }];
        },
    };
}
function normalizeRoot(root) {
    const normalized = portablePath(root.trim()).replace(/^\.\//u, '').replace(/\/$/u, '') || '.';
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
        throw new Error(`Repository statistics ownership root must be repository-relative: ${root}.`);
    }
    return normalized;
}
function owns(root, path) {
    return root === '.' || path === root || path.startsWith(`${root}/`);
}
function depth(root) {
    return root === '.' ? 0 : root.split('/').length;
}
//# sourceMappingURL=grouping.js.map