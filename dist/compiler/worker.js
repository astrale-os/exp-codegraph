import { compileApis } from './compile.js';
const chunks = [];
for await (const chunk of process.stdin)
    chunks.push(Buffer.from(chunk));
let options;
let result;
try {
    options = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    result = await compileApis(options);
}
catch (error) {
    const failure = {
        ok: false,
        diagnostics: [
            {
                source: 'isolation',
                code: 'isolation/request-invalid',
                severity: 'error',
                message: error instanceof Error ? error.message : String(error),
            },
        ],
    };
    result = Array.from({ length: options?.length ?? 1 }, () => failure);
}
for (const compilation of result)
    process.stdout.write(`${JSON.stringify(compilation)}\n`);
//# sourceMappingURL=worker.js.map