import { afterEach, describe, expect, it } from 'vitest'

import {
  CHECK_RESULT_FORMAT,
  CHECK_RESULT_VERSION,
  CHECK_SEMANTIC_PLAN,
  type StoredCheckResult,
} from '../cli/semantic-pack/model.ts'
import {
  loadSemanticPack,
  publishSemanticPack,
  semanticPackScope,
} from '../cli/semantic-pack/store.ts'
import { createFileWorkspaceCheckpointStore } from '../workspace/checkpoint/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('portable semantic check packs', () => {
  /** @evidence CLI-SEMANTIC-PACK-IDENTITY-ATOMICITY */
  it('binds every root identity and exposes one complete concurrently published result', async () => {
    const physical = await fixture({})
    fixtures.push(physical)
    const store = createFileWorkspaceCheckpointStore({ directory: physical.root })
    const identity = {
      sourceProof: 'source-proof:fixture',
      producerFingerprint: 'producer-fixture',
      repository: 'repository:fixture',
      family: 'family-fixture',
    }
    const scope = semanticPackScope(identity)
    const application = {
      scope: `application-${'a'.repeat(32)}`,
      manifestSha256: 'b'.repeat(64),
    }
    const first = result('snapshot:first', 0, 'first')
    const second = result('snapshot:second', 1, 'second')
    const published = await publishSemanticPack(
      store,
      scope,
      first,
      identity.family,
      identity.sourceProof,
      { application },
    )
    expect(published).toMatchObject({ outcome: 'published', code: 'published-with-application' })

    const exact = await loadSemanticPack(store, scope, {
      ...identity,
      request: first.request,
    }, false)
    expect(exact).toMatchObject({ result: first, application, event: { outcome: 'hit' } })
    for (const expectation of [
      { ...identity, producerFingerprint: 'other-producer', request: first.request },
      { ...identity, sourceProof: 'source-proof:other', request: first.request },
      { ...identity, repository: 'repository:other', request: first.request },
      { ...identity, family: 'other-family', request: first.request },
    ]) {
      expect((await loadSemanticPack(store, scope, expectation, false)).event.outcome).toBe('miss')
    }
    expect(await loadSemanticPack(store, scope, {
      ...identity,
      request: 'different-request',
    }, false)).toMatchObject({
      application,
      event: { outcome: 'miss', code: 'request-mismatch' },
    })

    await Promise.all([
      publishSemanticPack(store, scope, first, identity.family, identity.sourceProof),
      publishSemanticPack(store, scope, second, identity.family, identity.sourceProof),
    ])
    const raced = await loadSemanticPack(store, scope, {
      ...identity,
      request: first.request,
    }, false)
    expect([
      ['snapshot:first', 0, 'first'],
      ['snapshot:second', 1, 'second'],
    ]).toContainEqual([
      raced.result?.snapshot,
      raced.result?.exitCode,
      raced.result?.transcript[0]?.message,
    ])

    const controller = new AbortController()
    controller.abort(new Error('fixture interruption'))
    const interruptedStore = createFileWorkspaceCheckpointStore({
      directory: physical.root,
      signal: controller.signal,
    })
    expect(await publishSemanticPack(
      interruptedStore,
      scope,
      result('snapshot:interrupted', 0, 'interrupted'),
      identity.family,
      identity.sourceProof,
    )).toMatchObject({ outcome: 'failed', code: 'publication-failed' })
    expect((await loadSemanticPack(store, scope, {
      ...identity,
      request: first.request,
    }, false)).result).toEqual(raced.result)
    await interruptedStore.dispose()
    await store.dispose()
  })

  /** @evidence CLI-ACCELERATION-WORK-OBSERVABILITY */
  it('reports exact encoded and decoded semantic-pack shard work', async () => {
    const physical = await fixture({})
    fixtures.push(physical)
    const store = createFileWorkspaceCheckpointStore({ directory: physical.root })
    const identity = {
      sourceProof: 'source-proof:work',
      producerFingerprint: 'producer-fixture',
      repository: 'repository:fixture',
      family: 'family-fixture',
    }
    const scope = semanticPackScope(identity)
    const stored = { ...result('snapshot:work', 0, 'work'), sourceProof: identity.sourceProof }

    const published = await publishSemanticPack(
      store,
      scope,
      stored,
      identity.family,
      identity.sourceProof,
    )
    const loaded = await loadSemanticPack(
      store,
      scope,
      { ...identity, request: stored.request },
      false,
    )

    expect(published.work).toMatchObject({
      bytesWritten: expect.any(Number),
      bytesDecoded: expect.any(Number),
      writtenShards: 1,
    })
    expect(loaded.event.work).toEqual({
      bytesRead: published.work?.bytesWritten,
      bytesDecoded: published.work?.bytesDecoded,
      loadedShards: 1,
    })
    await store.dispose()
  })

  /** @evidence CLI-SEMANTIC-PACK-PLAN-BINDING */
  it('rejects semantic plan drift before loading a result shard', async () => {
    const physical = await fixture({})
    fixtures.push(physical)
    const store = createFileWorkspaceCheckpointStore({ directory: physical.root })
    const identity = {
      sourceProof: 'source-proof:fixture',
      producerFingerprint: 'producer-fixture',
      repository: 'repository:fixture',
      family: 'family-fixture',
    }
    const scope = semanticPackScope(identity)
    const stored = result('snapshot:plan', 0, 'plan')
    await publishSemanticPack(store, scope, stored, identity.family, identity.sourceProof)
    const loaded = await store.load(scope)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.manifest.payload).toMatchObject({ plan: CHECK_SEMANTIC_PLAN })
    const { scope: _scope, artifacts: _descriptors, ...manifest } = loaded.manifest
    const payload = manifest.payload as Record<string, unknown>
    await store.publish(scope, {
      manifest: {
        ...manifest,
        payload: {
          ...payload,
          plan: { ...CHECK_SEMANTIC_PLAN, compilerAnalysis: true },
        },
      },
      artifacts: loaded.artifacts,
    })

    expect((await loadSemanticPack(
      store,
      scope,
      { ...identity, request: stored.request },
      false,
    )).event).toMatchObject({ outcome: 'miss', code: 'manifest-incompatible' })
    await store.dispose()
  })

  it('rejects a malformed application reference before exposing an exact result', async () => {
    const physical = await fixture({})
    fixtures.push(physical)
    const store = createFileWorkspaceCheckpointStore({ directory: physical.root })
    const identity = {
      sourceProof: 'source-proof:fixture',
      producerFingerprint: 'producer-fixture',
      repository: 'repository:fixture',
      family: 'family-fixture',
    }
    const scope = semanticPackScope(identity)
    await publishSemanticPack(
      store,
      scope,
      result('snapshot:invalid-reference', 0, 'invalid-reference'),
      identity.family,
      identity.sourceProof,
      {
        application: {
          scope: 'invalid',
          manifestSha256: 'invalid',
        },
      },
    )
    const rejected = await loadSemanticPack(store, scope, {
      ...identity,
      request: 'request-fixture',
    }, false)
    expect(rejected).toMatchObject({
      event: { outcome: 'miss', code: 'application-reference-invalid' },
    })
    expect(rejected.result).toBeUndefined()
    await store.dispose()
  })
})

function result(snapshot: string, exitCode: 0 | 1, message: string): StoredCheckResult {
  return {
    format: CHECK_RESULT_FORMAT,
    version: CHECK_RESULT_VERSION,
    producerFingerprint: 'producer-fixture',
    sourceProof: 'source-proof:fixture',
    request: 'request-fixture',
    repository: 'repository:fixture',
    inventory: 'inventory:fixture',
    snapshot,
    exitCode,
    transcript: [{ channel: 'stdout', message }],
  }
}
