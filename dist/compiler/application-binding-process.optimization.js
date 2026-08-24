import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileApplicationModuleBindings } from './application-binding.js';
const WORKER_ARGUMENT = '--codegraph-binding-worker';
const MAXIMUM_OLD_SPACE_MIB = 512;
const MAXIMUM_OUTPUT_BYTES = 64 * 1_024 * 1_024;
const MAXIMUM_STDERR_BYTES = 1 * 1_024 * 1_024;
const TIMEOUT_MS = 60_000;
const RESOURCE_FORMAT = 'astrale.codegraph.binding-worker-resource';
/** Execute compatible binding Programs serially so their compiler heaps cannot accumulate. */
export async function compileApplicationModuleBindingsIsolated(options) {
    const started = performance.now();
    options.signal?.throwIfAborted();
    const compilations = [await runWorker(options.root, options.requests, options.ownershipRequests, options.signal)];
    return {
        facts: compilations.flatMap((compilation) => compilation.facts)
            .sort((left, right) => left.target.id.localeCompare(right.target.id)),
        programs: compilations.reduce((total, compilation) => total + compilation.programs, 0),
        sourceFiles: compilations.reduce((total, compilation) => total + compilation.sourceFiles, 0),
        durationMs: round(performance.now() - started),
        programMs: sum(compilations, 'programMs'),
        diagnosticsMs: sum(compilations, 'diagnosticsMs'),
        surfaceMs: sum(compilations, 'surfaceMs'),
        exportsMs: sum(compilations, 'exportsMs'),
        dependenciesMs: sum(compilations, 'dependenciesMs'),
        evidenceMs: sum(compilations, 'evidenceMs'),
        workerPeakResidentBytes: Math.max(0, ...compilations.map((value) => value.workerPeakResidentBytes)),
        workerResidentUpperBoundBytes: Math.max(0, ...compilations.map((value) => value.workerResidentUpperBoundBytes)),
    };
}
function runWorker(root, requests, ownershipRequests, signal) {
    return new Promise((resolvePromise, reject) => {
        const worker = fileURLToPath(import.meta.url);
        const child = spawn(process.execPath, [`--max-old-space-size=${MAXIMUM_OLD_SPACE_MIB}`, worker, WORKER_ARGUMENT], { stdio: ['pipe', 'pipe', 'pipe'] });
        const stdout = [];
        const stderr = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        const finish = (error, result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (error)
                reject(error);
            else
                resolvePromise(result);
        };
        const fail = (message) => {
            if (!child.killed)
                child.kill('SIGKILL');
            finish(new Error(message));
        };
        const abort = () => fail('Application module binding compilation was aborted.');
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => fail(`Application module binding worker exceeded ${TIMEOUT_MS} ms.`), TIMEOUT_MS);
        child.stdout.on('data', (chunk) => {
            stdoutBytes += chunk.byteLength;
            if (stdoutBytes > MAXIMUM_OUTPUT_BYTES)
                return fail('Application module binding worker output exceeded its limit.');
            stdout.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderrBytes += chunk.byteLength;
            if (stderrBytes > MAXIMUM_STDERR_BYTES)
                return fail('Application module binding worker diagnostics exceeded their limit.');
            stderr.push(chunk);
        });
        child.on('error', (error) => finish(error));
        child.on('close', (code, closeSignal) => {
            if (settled)
                return;
            if (code !== 0) {
                return finish(new Error(`Application module binding worker exited with ${closeSignal ?? code ?? 'unknown status'}: ${Buffer.concat(stderr).toString('utf8').trim()}`));
            }
            try {
                const result = JSON.parse(Buffer.concat(stdout).toString('utf8'));
                const resource = JSON.parse(Buffer.concat(stderr).toString('utf8'));
                if (resource.format !== RESOURCE_FORMAT ||
                    resource.version !== 1 ||
                    !Number.isSafeInteger(resource.peakResidentBytes) ||
                    resource.peakResidentBytes < 1)
                    throw new Error('Application module binding worker resource report is invalid.');
                finish(undefined, {
                    ...result,
                    workerPeakResidentBytes: resource.peakResidentBytes,
                    workerResidentUpperBoundBytes: resource.peakResidentBytes,
                });
            }
            catch (error) {
                finish(error);
            }
        });
        child.stdin.end(JSON.stringify({ root, requests, ownershipRequests }));
    });
}
function sum(values, key) {
    return round(values.reduce((total, value) => total + value[key], 0));
}
function round(value) {
    return Math.round(value * 1_000) / 1_000;
}
if (process.argv.includes(WORKER_ARGUMENT)) {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(Buffer.from(chunk));
    const options = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const result = compileApplicationModuleBindings(options);
    process.stdout.write(JSON.stringify(result));
    process.stderr.write(JSON.stringify({
        format: RESOURCE_FORMAT,
        version: 1,
        peakResidentBytes: process.resourceUsage().maxRSS * 1_024,
    }));
}
//# sourceMappingURL=application-binding-process.optimization.js.map