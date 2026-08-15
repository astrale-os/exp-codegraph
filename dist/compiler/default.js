import { readBounded, sourceRevision } from '../source/file.js';
import { createCachedApiCompiler } from './cache.js';
import { createCoalescingApiCompiler } from './coalesce.js';
import { compileApisIsolated } from './isolate.js';
const isolatedApiCompiler = createCachedApiCompiler(createCoalescingApiCompiler({ compileMany: compileApisIsolated }), {
    read: readBounded,
    revision: sourceRevision,
});
/** Process-local declaration compiler and restorable cache lifecycle. */
export const defaultApiCompiler = isolatedApiCompiler;
/**
 * Normative declaration port over the isolated project/cache lifecycle.
 * V2 semantics are explicit so no caller can silently fall back to the retired V1 oracle.
 */
export const specificationApiCompiler = {
    compile(options) {
        return isolatedApiCompiler.compile({ ...options, semantics: 'specification-v2' });
    },
};
//# sourceMappingURL=default.js.map