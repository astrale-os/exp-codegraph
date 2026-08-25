import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codegraphWorkerProcess } from '../../compiler/worker-process.js';
const MAXIMUM_OLD_SPACE_MIB = 504;
const MAXIMUM_OUTPUT_BYTES = 64 * 1_024 * 1_024;
const MAXIMUM_STDERR_BYTES = 1 * 1_024 * 1_024;
const TIMEOUT_MS = 60_000;
/** Execute exact preplanned whole-corpus groups serially behind bounded compiler heaps. */
export async function analyzeModuleTypeScriptGroupsIsolated(root, groups) {
    const results = [];
    for (const group of groups)
        results.push(await runWorker(root, [group]));
    return {
        entries: results.flatMap((result) => result.entries),
        programs: results.reduce((total, result) => total + result.programs, 0),
        workerPeakResidentBytes: Math.max(0, ...results.map((result) => result.peakResidentBytes)),
        workerResidentUpperBoundBytes: Math.max(0, ...results.map((result) => result.peakResidentBytes)),
    };
}
function runWorker(root, groups) {
    return new Promise((resolvePromise, reject) => {
        const extension = extname(fileURLToPath(import.meta.url));
        const worker = fileURLToPath(new URL(`./typescript-worker.optimization${extension}`, import.meta.url));
        const workerProcess = codegraphWorkerProcess('specification-typescript', worker, MAXIMUM_OLD_SPACE_MIB);
        const child = spawn(workerProcess.executable, workerProcess.arguments, { stdio: ['pipe', 'pipe', 'pipe'] });
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
        const timer = setTimeout(() => fail(`Specification TypeScript worker exceeded ${TIMEOUT_MS} ms.`), TIMEOUT_MS);
        child.stdout.on('data', (chunk) => {
            stdoutBytes += chunk.byteLength;
            if (stdoutBytes > MAXIMUM_OUTPUT_BYTES)
                return fail('Specification TypeScript worker output exceeded its limit.');
            stdout.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderrBytes += chunk.byteLength;
            if (stderrBytes > MAXIMUM_STDERR_BYTES)
                return fail('Specification TypeScript worker diagnostics exceeded their limit.');
            stderr.push(chunk);
        });
        child.on('error', (error) => finish(error));
        child.on('close', (code, signal) => {
            if (settled)
                return;
            if (code !== 0) {
                return finish(new Error(`Specification TypeScript worker exited with ${signal ?? code ?? 'unknown status'}: ${Buffer.concat(stderr).toString('utf8').trim()}`));
            }
            try {
                const result = JSON.parse(Buffer.concat(stdout).toString('utf8'));
                const resource = JSON.parse(Buffer.concat(stderr).toString('utf8'));
                if (!Number.isSafeInteger(resource.peakResidentBytes) || resource.peakResidentBytes < 1) {
                    throw new Error('Specification TypeScript worker resource report is invalid.');
                }
                finish(undefined, { ...result, peakResidentBytes: resource.peakResidentBytes });
            }
            catch (error) {
                finish(error);
            }
        });
        child.stdin.end(JSON.stringify({ root, groups }));
    });
}
//# sourceMappingURL=typescript-process.optimization.js.map