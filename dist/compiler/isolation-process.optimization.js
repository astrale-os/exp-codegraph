import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseApiCompilerWorkerResourceReport, recordApiCompilerIsolationWork, } from './isolation-work.optimization.js';
import { codegraphWorkerProcess } from './worker-process.js';
const DEFAULT_TIMEOUT_PER_ENTRYPOINT_MS = 20_000;
const DEFAULT_MAX_OLD_SPACE_MEGABYTES = 256;
const DEFAULT_MAX_WORKER_RESULT_BYTES = 16 * 1_024 * 1_024;
const DEFAULT_MAX_BATCH_RESULT_BYTES = 64 * 1_024 * 1_024;
const MAX_WORKER_STDERR_BYTES = 16 * 1_024 * 1_024;
/** Execute one bounded declaration universe and admit its private result/resource protocol. */
export function compileApisInIsolatedWorker(options, isolation) {
    // The default deadline scales only with the already-bounded batch cardinality.
    const timeoutMs = positiveInteger(isolation.timeoutMs, DEFAULT_TIMEOUT_PER_ENTRYPOINT_MS * options.length);
    const maxOldSpaceMegabytes = positiveInteger(isolation.maxOldSpaceMegabytes, DEFAULT_MAX_OLD_SPACE_MEGABYTES);
    const maxResultBytes = positiveInteger(isolation.maxResultBytes, DEFAULT_MAX_WORKER_RESULT_BYTES);
    const maxBatchResultBytes = positiveInteger(isolation.maxBatchResultBytes, DEFAULT_MAX_BATCH_RESULT_BYTES);
    const extension = extname(fileURLToPath(import.meta.url));
    const worker = fileURLToPath(new URL(`./worker${extension}`, import.meta.url));
    const workerProcess = codegraphWorkerProcess('api-compiler', worker, maxOldSpaceMegabytes);
    return new Promise((resolve) => {
        const child = spawn(workerProcess.executable, workerProcess.arguments, { stdio: ['pipe', 'pipe', 'pipe'] });
        let pendingStdout = Buffer.alloc(0);
        let stdoutBytes = 0;
        const results = [];
        const stderrChunks = [];
        let stderrBytes = 0;
        let settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const fail = (code, message) => {
            if (!child.killed)
                child.kill('SIGKILL');
            finish(options.map(() => ({ ok: false, diagnostics: [diagnostic(code, message)] })));
        };
        const timer = setTimeout(() => {
            const subject = options.length === 1
                ? 'API declaration compilation'
                : `API declaration batch of ${options.length} entrypoints`;
            fail('isolation/timeout', `${subject} exceeded ${timeoutMs} ms.`);
        }, timeoutMs);
        const acceptResult = (line) => {
            if (settled || line.byteLength === 0)
                return;
            if (line.byteLength > maxResultBytes) {
                fail('isolation/output-limit', `One API compiler result exceeded its ${maxResultBytes}-byte output limit.`);
                return;
            }
            try {
                results.push(JSON.parse(line.toString('utf8')));
            }
            catch (error) {
                fail('isolation/protocol-error', `API compiler worker returned invalid output: ${error instanceof Error ? error.message : String(error)}`);
            }
        };
        child.stdout.on('data', (chunk) => {
            if (settled)
                return;
            stdoutBytes += chunk.byteLength;
            if (stdoutBytes > maxBatchResultBytes) {
                fail('isolation/output-limit', `API compiler batch exceeded its ${maxBatchResultBytes}-byte output limit.`);
                return;
            }
            const available = pendingStdout.byteLength ? Buffer.concat([pendingStdout, chunk]) : chunk;
            let start = 0;
            for (let newline = available.indexOf(0x0a, start); newline >= 0; newline = available.indexOf(0x0a, start)) {
                acceptResult(available.subarray(start, newline));
                if (settled)
                    return;
                start = newline + 1;
            }
            pendingStdout = available.subarray(start);
            if (pendingStdout.byteLength > maxResultBytes) {
                fail('isolation/output-limit', `One API compiler result exceeded its ${maxResultBytes}-byte output limit.`);
            }
        });
        child.stderr.on('data', (chunk) => {
            stderrBytes += chunk.byteLength;
            if (stderrBytes > MAX_WORKER_STDERR_BYTES) {
                fail('isolation/output-limit', 'API compiler worker exceeded its output limit.');
                return;
            }
            stderrChunks.push(chunk);
        });
        child.on('error', (error) => fail('isolation/worker-error', error.message));
        child.on('close', (exitCode, signal) => {
            if (settled)
                return;
            if (exitCode !== 0) {
                const detail = Buffer.concat(stderrChunks, stderrBytes).toString('utf8').trim();
                fail('isolation/worker-failed', `API compiler worker exited with ${signal ?? exitCode ?? 'unknown status'}${detail ? `: ${detail}` : '.'}`);
                return;
            }
            if (pendingStdout.byteLength > 0)
                acceptResult(pendingStdout);
            if (settled)
                return;
            if (results.length !== options.length) {
                fail('isolation/protocol-error', `API compiler worker returned ${results.length} results for ${options.length} requests.`);
                return;
            }
            let peakResidentBytes;
            try {
                peakResidentBytes = parseApiCompilerWorkerResourceReport(Buffer.concat(stderrChunks, stderrBytes));
            }
            catch (error) {
                fail('isolation/protocol-error', error instanceof Error ? error.message : String(error));
                return;
            }
            recordApiCompilerIsolationWork({
                workerPeakResidentBytes: peakResidentBytes,
                workerResidentUpperBoundBytes: peakResidentBytes,
            });
            finish(results);
        });
        child.stdin.end(JSON.stringify(options));
    });
}
function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
function diagnostic(code, message) {
    return { source: 'isolation', code, severity: 'error', message };
}
//# sourceMappingURL=isolation-process.optimization.js.map