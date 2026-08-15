import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { optionalDirectFile } from '../../source/file.js';
import { inventoryModuleFiles } from '../module/inventory.js';
import { loadPackagePatterns, loadPackages } from './resources.js';
/** Resolve the one package-root specification that governs every nested semantic module. */
export async function loadSpecificationPackageAuthority(catalogRoot, moduleRoot, localInventory) {
    const packageRoot = await nearestPackageRoot(catalogRoot, moduleRoot);
    const authoritySpec = packageRoot ? join(packageRoot, '.spec') : undefined;
    const authorityInventory = authoritySpec && (await optionalDirectFile(join(authoritySpec, 'api.d.ts')))
        ? resolve(authoritySpec) === resolve(dirname(localInventory.api.absolute))
            ? localInventory
            : await inventoryModuleFiles(catalogRoot, authoritySpec)
        : localInventory;
    const [packages, packagePatterns] = await Promise.all([
        loadPackages(authorityInventory.packages),
        authorityInventory.packageExceptions
            ? loadPackagePatterns(authorityInventory.packageExceptions)
            : Promise.resolve({ resources: [], diagnostics: [] }),
    ]);
    return {
        authority: {
            source: authorityInventory.api.source,
            packages: packages.resources,
            packagePatterns: packagePatterns.resources,
        },
        diagnostics: [...packages.diagnostics, ...packagePatterns.diagnostics],
    };
}
async function nearestPackageRoot(catalogRoot, moduleRoot) {
    const root = resolve(catalogRoot);
    let current = resolve(moduleRoot);
    while (within(root, current)) {
        if (await optionalDirectFile(join(current, 'package.json')))
            return current;
        if (current === root)
            return;
        current = dirname(current);
    }
    return;
}
function within(root, target) {
    const path = relative(root, target);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
//# sourceMappingURL=package-authority.js.map