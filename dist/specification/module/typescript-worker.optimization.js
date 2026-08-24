import { analyzeModuleTypeScriptIsolationGroup } from './typescript.js';
const chunks = [];
for await (const chunk of process.stdin)
    chunks.push(Buffer.from(chunk));
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const results = [];
for (const inventories of request.groups) {
    results.push(await analyzeModuleTypeScriptIsolationGroup(request.root, inventories));
}
const result = {
    entries: results.flatMap((value) => value.entries),
    programs: results.reduce((total, value) => total + value.programs, 0),
};
process.stdout.write(JSON.stringify(result));
process.stderr.write(JSON.stringify({ peakResidentBytes: process.resourceUsage().maxRSS * 1_024 }));
//# sourceMappingURL=typescript-worker.optimization.js.map