import { basename } from 'node:path';
import { specificationApiCompiler } from '../../compiler/default.js';
import { apiCompilerIsolationWork } from '../../compiler/isolation-work.optimization.js';
import { SPECIFICATION_COMPILER_BATCH_CAPACITY } from '../../source/resource-limits.js';
import { withOperationSnapshot } from '../../source/operation-snapshot.js';
import { inventoryModuleFiles } from '../module/inventory.js';
import { prepareModuleTypeScriptAnalyses } from '../module/typescript.js';
import { configureSpecificationDeclarationModels, configureSpecificationDeclarationNavigation, seedSpecificationDeclarationResources, } from '../declaration.js';
import { compileSpecificationSnapshot } from './compile.js';
/**
 * Compile one coherent corpus through bounded shared declaration and TypeScript waves.
 * The preparation stage is an optimization only; every module still compiles into its
 * independently content-addressed normative snapshot.
 */
export function compileSpecificationSnapshots(root, directories, options = {}) {
    return withOperationSnapshot(async () => {
        const includeDeclarationNavigation = options.includeDeclarationNavigation !== false;
        const includeDeclarationModels = options.includeDeclarationModels !== false;
        if (includeDeclarationNavigation && !includeDeclarationModels) {
            throw new TypeError('Declaration navigation requires declaration models.');
        }
        configureSpecificationDeclarationNavigation(includeDeclarationNavigation);
        configureSpecificationDeclarationModels(includeDeclarationModels);
        const maximum = positiveInteger(options.maximumConcurrency, SPECIFICATION_COMPILER_BATCH_CAPACITY);
        const moduleDirectories = directories.filter((directory) => basename(directory) === '.spec');
        let started = performance.now();
        const inventories = await mapConcurrent(moduleDirectories, maximum, (directory) => inventoryModuleFiles(root, directory));
        report(options.onPhase, {
            phase: 'inventory',
            durationMs: performance.now() - started,
            items: inventories.length,
        });
        const restoredDeclarations = seedSpecificationDeclarationResources(options.previous ?? [], options.changed ?? []);
        const typeScript = await prepareSpecificationCompilation(root, inventories, options.onPhase, restoredDeclarations, includeDeclarationNavigation, includeDeclarationModels);
        await Promise.race([typeScript.scheduled, typeScript.completed]);
        const snapshotsStarted = performance.now();
        const snapshotsPending = mapConcurrent(moduleDirectories, maximum, (directory) => compileSpecificationSnapshot(root, directory));
        await typeScript.completed;
        const typeScriptTailAfterSnapshotSchedulingMs = performance.now() - snapshotsStarted;
        report(options.onPhase, {
            phase: 'typescript',
            durationMs: performance.now() - typeScript.started,
            items: inventories.length,
            programs: typeScript.programs(),
            sessions: 1,
            typeScriptTailAfterSnapshotSchedulingMs,
        });
        const snapshots = await snapshotsPending;
        report(options.onPhase, {
            phase: 'snapshots',
            durationMs: performance.now() - snapshotsStarted,
            items: snapshots.length,
            typeScriptTailAfterSnapshotSchedulingMs,
        });
        return snapshots.sort((left, right) => compare(left.source, right.source));
    });
}
async function prepareSpecificationCompilation(root, inventories, onPhase, restored, includeDeclarationNavigation, includeDeclarationModels) {
    const declarations = uniqueFiles(inventories.flatMap((inventory) => [
        inventory.api,
        ...(inventory.internal ? [inventory.internal] : []),
        ...inventory.ports,
    ])).filter((file) => !restored.has(file.source));
    let started = performance.now();
    await Promise.all(declarations.map((file) => specificationApiCompiler.compile({
        mainFile: file.absolute,
        projectRoot: root,
        declarationNavigation: includeDeclarationNavigation,
        declarationModel: includeDeclarationModels,
    })));
    const isolation = apiCompilerIsolationWork();
    report(onPhase, {
        phase: 'declarations',
        durationMs: performance.now() - started,
        items: declarations.length,
        programs: isolation.programs,
        sessions: isolation.sessions,
        retries: isolation.retries,
        fallbacks: isolation.plannerFallbacks,
        workerPeakResidentBytes: isolation.workerPeakResidentBytes,
        workerResidentUpperBoundBytes: isolation.workerResidentUpperBoundBytes,
        parentPeakResidentBytes: process.resourceUsage().maxRSS * 1_024,
    });
    const typeScriptStarted = performance.now();
    let signalScheduled;
    const scheduled = new Promise((resolve) => {
        signalScheduled = resolve;
    });
    let programs = 0;
    const completed = prepareModuleTypeScriptAnalyses(root, inventories, (phase) => {
        if (phase.phase === 'program')
            programs += phase.items;
    }, signalScheduled);
    return { started: typeScriptStarted, scheduled, completed, programs: () => programs };
}
function report(observer, phase) {
    try {
        observer?.(phase);
    }
    catch {
        // Diagnostic observation cannot change canonical compilation.
    }
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