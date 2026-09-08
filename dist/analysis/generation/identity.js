import { types } from 'node:util';
import { deriveAnalysisId } from '../identity/index.js';
import { createAnalysisIdentityHash } from '../identity/hash.js';
import { stableJson } from '../identity/model.js';
// A weak cache cannot retain evicted generations. Only immutable flat data
// records qualify: freezing a parent alone cannot certify nested objects or
// accessors supplied by a custom store.
const REFERENCES = new WeakMap();
export function hashGenerationIdentity(generation, manifest) {
    // Keep the existing input-read order and the exact v1 canonical preimage.
    const input = {
        universe: generation.universe,
        producer: generation.producer,
        sourceManifest: generation.sourceManifest,
        capabilities: [...new Set(generation.capabilities)].sort(),
        manifest: [...manifest].sort((left, right) => left.key.localeCompare(right.key)),
    };
    const generic = () => deriveAnalysisId('generation', 'astrale.analysis.generation.v1', input);
    if (typeof input.universe !== 'string' || typeof input.sourceManifest !== 'string' ||
        !flatRecord(input.producer) || input.capabilities.some(value => typeof value !== 'string'))
        return generic();
    const hash = createAnalysisIdentityHash('generation', 'astrale.analysis.generation.v1');
    hash.update('{"capabilities":').update(stableJson(input.capabilities)).update(',"manifest":[');
    let pending = [];
    let characters = 0;
    for (let index = 0; index < input.manifest.length; index++) {
        const reference = input.manifest[index];
        // A custom getter/toJSON/nested object keeps the original whole-value
        // canonicalizer, including its observation order and JSON key semantics.
        if (!REFERENCES.has(reference) && !flatRecord(reference))
            return generic();
        const encoded = encodeReference(reference);
        if (index)
            pending.push(',');
        pending.push(encoded);
        characters += encoded.length + 1;
        // The complete SHA still visits every byte, but unchanged references are
        // not canonicalized again and no whole-manifest JSON graph/string exists.
        if (characters >= 32_768) {
            hash.update(pending.join(''));
            pending = [];
            characters = 0;
        }
    }
    if (pending.length)
        hash.update(pending.join(''));
    hash.update('],"producer":').update(stableJson(input.producer))
        .update(',"sourceManifest":').update(stableJson(input.sourceManifest))
        .update(',"universe":').update(stableJson(input.universe)).update('}');
    return `generation:${hash.digest('hex')}`;
}
function encodeReference(reference) {
    const previous = REFERENCES.get(reference);
    if (previous !== undefined)
        return previous;
    const encoded = stableJson(reference);
    if (Object.isFrozen(reference))
        REFERENCES.set(reference, encoded);
    return encoded;
}
function flatRecord(value) {
    if (!value || typeof value !== 'object' || types.isProxy(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        return false;
    for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!('value' in descriptor))
            return false;
        const entry = descriptor.value;
        if (entry !== null && (typeof entry === 'object' || typeof entry === 'function'))
            return false;
    }
    return true;
}
//# sourceMappingURL=identity.js.map