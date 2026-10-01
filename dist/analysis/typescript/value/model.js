/** Private computation must be replayed against an expanded immutable generation. */
export class BodyDemandExpansionRequired extends Error {
    code = 'TYPESCRIPT_BODY_DEMAND_EXPANSION_REQUIRED';
    receipt;
    constructor(input) {
        super('Semantic evaluation requires additional revision-owned body facts.');
        this.name = 'BodyDemandExpansionRequired';
        const generation = input.generation, sourceManifest = input.sourceManifest;
        const requirements = new Map();
        for (const { owner, kind } of input.requirements) {
            if (typeof owner !== 'string' || owner.length === 0 || (kind !== 'body' && kind !== 'effect-order')) {
                throw new TypeError('Invalid body demand expansion requirement.');
            }
            requirements.set(`${owner}\0${kind}`, Object.freeze({ owner, kind }));
        }
        this.receipt = Object.freeze({ generation, sourceManifest,
            requirements: Object.freeze([...requirements.values()].sort((left, right) => left.owner.localeCompare(right.owner) || left.kind.localeCompare(right.kind))),
        });
    }
}
