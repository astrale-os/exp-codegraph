import type { ModuleFileInventory } from './inventory.ts'

import { analyzeModuleTypeScriptIsolationGroup } from './typescript.ts'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
  readonly root: string
  readonly groups: readonly (readonly ModuleFileInventory[])[]
}
const results = []
for (const inventories of request.groups) {
  results.push(await analyzeModuleTypeScriptIsolationGroup(request.root, inventories))
}
const result = {
  entries: results.flatMap((value) => value.entries),
  programs: results.reduce((total, value) => total + value.programs, 0),
}
process.stdout.write(JSON.stringify(result))
process.stderr.write(JSON.stringify({ peakResidentBytes: process.resourceUsage().maxRSS * 1_024 }))
