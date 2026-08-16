import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIFICATION_COMPILER_BATCH_CAPACITY } from '../source/resource-limits.js';
import { createTaskLimiter } from './limit.js';
const DEFAULT_TIMEOUT_PER_ENTRYPOINT_MS = 20_000;
const DEFAULT_MAX_OLD_SPACE_MEGABYTES = 256;
/** Shared load and worker capacity; large enough to amortize one TypeScript project construction. */
export const API_COMPILER_BATCH_CAPACITY = SPECIFICATION_COMPILER_BATCH_CAPACITY;
const DEFAULT_MAX_WORKER_RESULT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_BATCH_RESULT_BYTES = 64 * 1024 * 1024;
const MAX_WORKER_STDERR_BYTES = 16 * 1024 * 1024;
// Each worker may consume its full old-space allowance. Keep the aggregate bounded, and start
// an individual compilation deadline only after that compilation owns a worker slot.
const MAX_CONCURRENT_WORKERS = 4;
const workers = createTaskLimiter(MAX_CONCURRENT_WORKERS);
/**
 * Compile an untrusted API in a disposable, memory-bounded process.
 *
 * The worker uses the bounded native declaration compiler; the process boundary adds a hard
 * deadline and prevents compiler memory exhaustion from taking down the specification server.
 */
export async function compileApiIsolated(options) {
    return (await compileApisIsolated([options], options))[0];
}
export async function compileApisIsolated(options, isolation = {}) {
    if (!options.length)
        return [];
    const size = positiveInteger(isolation.maxBatchEntries, API_COMPILER_BATCH_CAPACITY);
    const batches = [];
    for (let index = 0; index < options.length; index += size) {
        batches.push(options.slice(index, index + size));
    }
    return (await Promise.all(batches.map((batch) => compileBatch(batch, isolation)))).flat();
}
async function compileBatch(options, isolation) {
    const results = await workers.run(() => compileInWorker(options, isolation));
    if (options.length < 2 || !batchOutputExceeded(results))
        return results;
    // The aggregate limit protects parent memory, not entrypoint validity. Retry smaller batches so
    // individually bounded results never change meaning based on their neighboring entrypoints.
    const middle = Math.ceil(options.length / 2);
    const [left, right] = await Promise.all([
        compileBatch(options.slice(0, middle), isolation),
        compileBatch(options.slice(middle), isolation),
    ]);
    return [...left, ...right];
}
function batchOutputExceeded(results) {
    return results.every((result) => result.diagnostics.some((entry) => entry.code === 'isolation/output-limit' &&
        entry.message.startsWith('API compiler batch exceeded its ')));
}
function compileInWorker(options, isolation) {
    // Batching amortizes project construction but still performs one semantic projection per
    // entrypoint. A fixed single-entrypoint deadline made otherwise valid bounded batches fail on
    // slower CI runners. Explicit caller deadlines remain exact; only the default scales with the
    // already-bounded batch cardinality.
    const timeoutMs = positiveInteger(isolation.timeoutMs, DEFAULT_TIMEOUT_PER_ENTRYPOINT_MS * options.length);
    const maxOldSpaceMegabytes = positiveInteger(isolation.maxOldSpaceMegabytes, DEFAULT_MAX_OLD_SPACE_MEGABYTES);
    const maxResultBytes = positiveInteger(isolation.maxResultBytes, DEFAULT_MAX_WORKER_RESULT_BYTES);
    const maxBatchResultBytes = positiveInteger(isolation.maxBatchResultBytes, DEFAULT_MAX_BATCH_RESULT_BYTES);
    const extension = extname(fileURLToPath(import.meta.url));
    const worker = fileURLToPath(new URL(`./worker${extension}`, import.meta.url));
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [`--max-old-space-size=${maxOldSpaceMegabytes}`, worker], { stdio: ['pipe', 'pipe', 'pipe'] });
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
        child.on('error', (error) => {
            fail('isolation/worker-error', error.message);
        });
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
//# sourceMappingURL=isolate.js.map