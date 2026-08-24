import { createHash } from 'node:crypto';
import { CHECK_SEMANTIC_PLAN } from './model.js';
/** Address one exact source, producer, repository, family, and semantic-plan pack. */
export function semanticPackScope(input) {
    const identity = JSON.stringify({ ...input, plan: CHECK_SEMANTIC_PLAN });
    return `semantic-pack-${createHash('sha256').update(identity).digest('hex')}`;
}
//# sourceMappingURL=identity.js.map