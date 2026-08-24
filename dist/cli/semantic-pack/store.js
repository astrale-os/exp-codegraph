import { admitApplicationCheckpointManifest, applicationCheckpointCorpus, } from '../../application/checkpoint/index.js';
import { decodeWorkspaceCheckpointJson, encodeWorkspaceCheckpointJson, } from '../../workspace/checkpoint/index.js';
import { createCliAccelerationEvent } from '../acceleration.js';
import { CHECK_CATALOG_ARTIFACT, CHECK_RESULT_ARTIFACT, CHECK_SEMANTIC_PLAN, MAXIMUM_CHECK_CATALOG_BYTES, MAXIMUM_CHECK_RESULT_BYTES, SEMANTIC_PACK_FORMAT, SEMANTIC_PACK_VERSION, isApplicationCheckpointReference, isCheckSemanticPlan, isStoredCheckCatalog, isStoredCheckResult, } from './model.js';
export { semanticPackScope } from './identity.js';
export async function publishSemanticPack(store, scope, result, family, sourceProof, options = {}) {
    const started = performance.now();
    try {
        const resultArtifact = encodeWorkspaceCheckpointJson(result, {
            maximumDecodedBytes: MAXIMUM_CHECK_RESULT_BYTES,
        });
        const catalogArtifact = options.catalog && encodeWorkspaceCheckpointJson(options.catalog, {
            maximumDecodedBytes: MAXIMUM_CHECK_CATALOG_BYTES,
        });
        await store.publish(scope, {
            manifest: {
                format: SEMANTIC_PACK_FORMAT,
                version: SEMANTIC_PACK_VERSION,
                producerFingerprint: result.producerFingerprint,
                payload: {
                    sourceProof,
                    repository: result.repository,
                    family,
                    request: result.request,
                    plan: CHECK_SEMANTIC_PLAN,
                    catalog: options.catalog !== undefined,
                    ...(options.application ? { application: options.application } : {}),
                },
            },
            artifacts: {
                [CHECK_RESULT_ARTIFACT]: resultArtifact.value,
                ...(catalogArtifact ? { [CHECK_CATALOG_ARTIFACT]: catalogArtifact.value } : {}),
            },
        });
        const artifacts = [resultArtifact, ...(catalogArtifact ? [catalogArtifact] : [])];
        return {
            ...createCliAccelerationEvent('semantic-pack-publish', 'published', options.application ? 'published-with-application' : 'published-compact', started),
            work: {
                bytesWritten: artifacts.reduce((total, artifact) => total + artifact.value.byteLength, 0),
                bytesDecoded: artifacts.reduce((total, artifact) => total + artifact.decodedBytes, 0),
                writtenShards: artifacts.length,
            },
        };
    }
    catch (error) {
        return createCliAccelerationEvent('semantic-pack-publish', 'failed', 'publication-failed', started, error);
    }
}
export async function loadSemanticPack(store, scope, expectation, allowCatalog) {
    const started = performance.now();
    const miss = (code, application) => ({
        ...(application ? { application } : {}),
        event: createCliAccelerationEvent('semantic-pack-read', 'miss', code, started),
    });
    try {
        const manifest = await store.load(scope, { artifactKeys: [] });
        if (!manifest.ok)
            return miss(manifest.reason);
        const payload = manifest.manifest.payload;
        if (manifest.manifest.format !== SEMANTIC_PACK_FORMAT ||
            manifest.manifest.version !== SEMANTIC_PACK_VERSION ||
            manifest.manifest.producerFingerprint !== expectation.producerFingerprint ||
            !payload ||
            typeof payload !== 'object' ||
            Array.isArray(payload))
            return miss('manifest-incompatible');
        const identity = payload;
        if (identity.sourceProof !== expectation.sourceProof ||
            identity.repository !== expectation.repository ||
            identity.family !== expectation.family)
            return miss('identity-mismatch');
        if (!isCheckSemanticPlan(identity.plan))
            return miss('manifest-incompatible');
        const application = isApplicationCheckpointReference(identity.application)
            ? identity.application
            : undefined;
        if (identity.application !== undefined && !application) {
            return miss('application-reference-invalid');
        }
        const exact = identity.request === expectation.request;
        if (!exact && (!allowCatalog || identity.catalog !== true)) {
            return miss('request-mismatch', application);
        }
        const key = exact ? CHECK_RESULT_ARTIFACT : CHECK_CATALOG_ARTIFACT;
        const selected = await store.load(scope, { artifactKeys: [key] });
        if (!selected.ok)
            return miss(selected.reason, application);
        const bytes = selected.artifacts.get(key);
        if (!bytes)
            return miss('artifact-missing', application);
        if (exact) {
            const decoded = decodeWorkspaceCheckpointJson(bytes, {
                maximumDecodedBytes: MAXIMUM_CHECK_RESULT_BYTES,
            });
            const result = decoded.value;
            if (!isStoredCheckResult(result))
                return miss('payload-invalid', application);
            if (result.producerFingerprint !== expectation.producerFingerprint ||
                result.sourceProof !== expectation.sourceProof ||
                result.request !== expectation.request ||
                result.repository !== expectation.repository)
                return miss('identity-mismatch', application);
            return {
                result,
                ...(application ? { application } : {}),
                event: {
                    ...createCliAccelerationEvent('semantic-pack-read', 'hit', 'admitted', started),
                    work: {
                        bytesRead: bytes.byteLength,
                        bytesDecoded: decoded.decodedBytes,
                        loadedShards: 1,
                    },
                },
            };
        }
        const decoded = decodeWorkspaceCheckpointJson(bytes, {
            maximumDecodedBytes: MAXIMUM_CHECK_CATALOG_BYTES,
        });
        const catalog = decoded.value;
        if (!isStoredCheckCatalog(catalog))
            return miss('payload-invalid', application);
        if (catalog.producerFingerprint !== expectation.producerFingerprint ||
            catalog.sourceProof !== expectation.sourceProof ||
            catalog.family !== expectation.family ||
            catalog.repository !== expectation.repository)
            return miss('identity-mismatch', application);
        return {
            catalog,
            ...(application ? { application } : {}),
            event: {
                ...createCliAccelerationEvent('semantic-pack-read', 'hit', 'catalog-admitted', started),
                work: {
                    bytesRead: bytes.byteLength,
                    bytesDecoded: decoded.decodedBytes,
                    loadedShards: 1,
                },
            },
        };
    }
    catch (error) {
        return {
            event: createCliAccelerationEvent('semantic-pack-read', 'failed', 'load-failed', started, error),
        };
    }
}
export async function portableApplicationReference(store, producerFingerprint, sourceProof, repository, inventory, exclude) {
    const admitted = await admitApplicationCheckpointManifest({
        store,
        producerFingerprint: `${producerFingerprint}:application-checkpoint/4`,
    }, {
        repository: repository,
        inventory: inventory,
        corpus: applicationCheckpointCorpus(exclude),
        sourceProof,
    });
    return admitted.ok ? admitted.reference : undefined;
}
//# sourceMappingURL=store.js.map