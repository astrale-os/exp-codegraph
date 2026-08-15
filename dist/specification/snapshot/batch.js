import { basename } from 'node:path';
import { specificationApiCompiler } from '../../compiler/default.js';
import { SPECIFICATION_COMPILER_BATCH_CAPACITY } from '../../source/resource-limits.js';
import { withOperationSnapshot } from '../../source/operation-snapshot.js';
import { inventoryModuleFiles } from '../module/inventory.js';
import { prepareModuleTypeScriptAnalyses } from '../module/typescript.js';
import { compileSpecificationSnapshot } from './compile.js';
/**
 * Compile one coherent corpus through bounded shared declaration and TypeScript waves.
 * The preparation stage is an optimization only; every module still compiles into its
 * independently content-addressed normative snapshot.
 */
export function compileSpecificationSnapshots(root, directories, options = {}) {
    return withOperationSnapshot(async () => {
        const maximum = positiveInteger(options.maximumConcurrency, SPECIFICATION_COMPILER_BATCH_CAPACITY);
        const moduleDirectories = directories.filter((directory) => basename(directory) === '.spec');
        const inventories = await mapConcurrent(moduleDirectories, maximum, (directory) => inventoryModuleFiles(root, directory));
        await prepareSpecificationCompilation(root, inventories);
        const snapshots = await mapConcurrent(moduleDirectories, maximum, (directory) => compileSpecificationSnapshot(root, directory));
        return snapshots.sort((left, right) => compare(left.source, right.source));
    });
}
async function prepareSpecificationCompilation(root, inventories) {
    const declarations = uniqueFiles(inventories.flatMap((inventory) => [
        inventory.api,
        ...(inventory.internal ? [inventory.internal] : []),
        ...inventory.ports,
    ]));
    await Promise.all(declarations.map((file) => specificationApiCompiler.compile({ mainFile: file.absolute, projectRoot: root })));
    await prepareModuleTypeScriptAnalyses(root, inventories);
}
function uniqueFiles(files) {
    const values = new Map();
    for (const file of files)
        values.set(file.absolute, file);
    return [...values.values()].sort((left, right) => compare(left.source, right.source));
}
async function mapConcurrent(inputs, maximum, operation) {
    const output = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(maximum, inputs.length) }, async () => {
        while (true) {
            const index = next++;
            if (index >= inputs.length)
                return;
            output[index] = await operation(inputs[index]);
        }
    }));
    return output;
}
function positiveInteger(value, fallback) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError('maximumConcurrency must be a positive safe integer.');
    }
    return value;
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=batch.js.map