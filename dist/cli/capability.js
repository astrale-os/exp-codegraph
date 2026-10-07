import { APPLICATION_TEST_FACT_NAMESPACE, } from '../application/observation/index.js';
import { deriveCapabilityStatuses } from '../specification/index.js';
/** Derive the status of every checked capability from citations and attached active tests. */
export async function capabilityReport(reader) {
    const snapshot = reader.snapshot;
    const citing = snapshot.specifications.some((specification) => specification.capabilities.some((resource) => resource.definitions.some((definition) => definition.laws?.length || definition.capabilities?.length)));
    // Without a citation every capability is declared; attached evidence cannot change that.
    const active = citing ? await activeLaws(reader) : new Map();
    const entries = deriveCapabilityStatuses(snapshot.specifications.map((specification) => ({
        root: specification.root,
        capabilities: specification.capabilities,
        laws: specification.laws.flatMap((resource) => resource.definitions.map((definition) => ({
            id: definition.id,
            active: active.get(specification.module.id)?.has(definition.id) === true,
        }))),
    }))).map(({ blocking, ...entry }) => entry.status === 'partial' ? { ...entry, blocking } : entry);
    const count = (status) => entries.filter((entry) => entry.status === status).length;
    return {
        declared: count('declared'),
        partial: count('partial'),
        held: count('held'),
        entries,
    };
}
/** One stable line; a scope without capabilities stays silent. */
export function capabilitySummary(report) {
    if (!report.entries.length)
        return;
    return `Capabilities: ${report.declared} declared, ${report.partial} partial, ${report.held} held.`;
}
async function activeLaws(reader) {
    const active = new Map();
    for (const universe of reader.snapshot.analysis?.universes ?? []) {
        const query = await reader.query(universe);
        try {
            for await (const fact of query.export({ namespaces: [APPLICATION_TEST_FACT_NAMESPACE] })) {
                const laws = active.get(fact.subject) ?? new Set();
                for (const law of fact.payload.laws) {
                    if (law.evidence.some((evidence) => evidence.status === 'active'))
                        laws.add(law.id);
                }
                active.set(fact.subject, laws);
            }
        }
        finally {
            await query.dispose();
        }
    }
    return active;
}
