const MAXIMUM_CONCURRENT_COMPILER_PROJECTS = 1;
const MAXIMUM_RESIDENT_COMPILER_PROJECTS = 1;
/** Canonical project grouping used by both routing and bounded compiler scheduling. */
export function groupApplicationCompilerProjects(boundaries) {
    const values = new Map();
    for (const boundary of boundaries) {
        const current = values.get(boundary.project) ?? [];
        current.push(boundary);
        values.set(boundary.project, current);
    }
    return new Map([...values]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([project, current]) => [
        project,
        current.sort((left, right) => left.id.localeCompare(right.id)),
    ]));
}
/** Refresh independent compiler universes concurrently while retaining canonical project order. */
export async function mapApplicationCompilerProjects(inputs, operation) {
    const output = new Array(inputs.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(MAXIMUM_CONCURRENT_COMPILER_PROJECTS, inputs.length) }, async () => {
        while (true) {
            const index = next++;
            if (index >= inputs.length)
                return;
            output[index] = await operation(inputs[index]);
        }
    }));
    return output;
}
/** Compact exact routing index; compiler processes themselves remain bounded separately. */
export class ApplicationCompilerRoutingIndex {
    #routes = new Map();
    reset() {
        this.#routes.clear();
    }
    update(project, routing) {
        if (!routing)
            return;
        const routes = routing.complete
            ? new Map()
            : new Map(this.#routes.get(project) ?? []);
        for (const route of routing.modules)
            routes.set(route.module, route);
        this.#routes.set(project, routes);
    }
    affected(projects, changes, conservative) {
        if (conservative || !changes?.length || changes.some((change) => change.kind !== 'change')) {
            return projects;
        }
        if (projects.some(([project]) => !this.#routes.has(project)))
            return projects;
        const projectByModule = new Map(projects.flatMap(([project, modules]) => modules.map((module) => [module.id, project])));
        const affected = new Set();
        for (const change of changes) {
            const owners = projects.flatMap(([project, modules]) => {
                const routed = [...(this.#routes.get(project)?.values() ?? [])]
                    .some((route) => route.files.includes(change.path));
                const bounded = modules.some((module) => change.path === module.root || change.path.startsWith(`${module.root}/`));
                return routed || bounded ? [project] : [];
            });
            if (!owners.length)
                return projects;
            for (const owner of owners)
                affected.add(owner);
        }
        let expanded = true;
        while (expanded) {
            expanded = false;
            for (const [project, routes] of this.#routes) {
                if (affected.has(project))
                    continue;
                if ([...routes.values()].some((route) => route.dependencies.some((module) => affected.has(projectByModule.get(module) ?? '')))) {
                    affected.add(project);
                    expanded = true;
                }
            }
        }
        return projects.filter(([project]) => affected.has(project));
    }
    retained(projects, residentModules) {
        const requested = new Set(residentModules ?? []);
        return new Set(projects
            .map(([project, modules]) => ({
            project,
            score: modules.filter((module) => requested.has(module.id)).length,
        }))
            .filter(({ score }) => score > 0)
            .sort((left, right) => right.score - left.score || left.project.localeCompare(right.project))
            .slice(0, MAXIMUM_RESIDENT_COMPILER_PROJECTS)
            .map(({ project }) => project));
    }
}
//# sourceMappingURL=workspace.optimization.js.map