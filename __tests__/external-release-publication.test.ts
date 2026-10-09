import { describe, expect, it } from 'vitest'
import { publishReleaseAssets } from '../scripts/native/publish-assets.mjs'

const sourceRevision = 'a'.repeat(40)
const packageVersion = '0.1.3'
const tag = `codegraph-v${packageVersion}-${sourceRevision}`
const assets = ['native-release.json', 'viewer-release.json', `native-darwin-arm64-${sourceRevision}.gz`, `viewer-${sourceRevision}.tar.gz`]
  .map((name, index) => ({ name, path: `/fixture/${name}`, bytes: index + 10, sha256: String(index + 1).repeat(64) }))
const input = { sourceRevision, packageVersion, assets }

function github(options: { existing?: boolean; published?: boolean; failUpload?: number } = {}) {
  let release: Record<string, unknown> | undefined = options.existing ? {
    id: 7, tag_name: tag, target_commitish: sourceRevision, prerelease: true, draft: !options.published,
  } : undefined
  let reference: Record<string, unknown> | undefined = options.published ? { object: { type: 'commit', sha: sourceRevision } } : undefined
  const remote: Array<Record<string, unknown>> = []
  const calls: Array<{ method: string; path: string }> = []
  let uploads = 0
  const api = async (method: string, path: string, body?: any) => {
    calls.push({ method, path })
    if (path.includes('/git/ref/')) return reference
    if (path.includes('/releases/tags/')) return release?.draft === false ? release : undefined
    if (path.includes('/releases?')) return release ? [release] : []
    if (method === 'POST') {
      release = { ...body, id: 7 }
      return release
    }
    if (method === 'GET' && path.includes('/assets?')) return [...remote]
    if (method === 'UPLOAD') {
      if (++uploads === options.failUpload) throw new Error('interrupted upload')
      const asset = { id: remote.length + 100, name: body.name, state: 'uploaded', size: body.bytes, digest: `sha256:${body.sha256}` }
      remote.push(asset)
      return asset
    }
    if (method === 'DELETE') {
      remote.splice(remote.findIndex(value => path.endsWith(`/${value.id}`)), 1)
      return
    }
    if (method === 'PATCH') {
      release = { ...release, ...body }
      reference = { object: { type: 'commit', sha: sourceRevision } }
      return release
    }
    throw new Error(`unexpected API operation ${method} ${path}`)
  }
  const complete = () => {
    remote.splice(0, remote.length, ...assets.map((asset, index) => ({ id: index + 100, name: asset.name, state: 'uploaded', size: asset.bytes, digest: `sha256:${asset.sha256}` })))
  }
  return { api, remote, calls, complete, release: () => release, setReference: (value: Record<string, unknown>) => { reference = value } }
}

describe('durable source-bound external release publication', () => {
  it('makes only the complete, admitted release public and pins its tag to the exact source', async () => {
    const remote = github()
    expect(await publishReleaseAssets(input, remote.api)).toMatchObject({ tag, sourceRevision, packageVersion, releaseId: 7 })
    expect(remote.release()).toMatchObject({ draft: false, prerelease: true, make_latest: 'false' })
    expect(remote.calls.filter(value => value.method === 'UPLOAD')).toHaveLength(assets.length)
    const patch = remote.calls.findIndex(value => value.method === 'PATCH')
    expect(remote.calls.slice(0, patch).filter(value => value.method === 'UPLOAD')).toHaveLength(assets.length)
  })

  it('reuses an identical published release without uploading, deleting or editing it', async () => {
    const remote = github({ existing: true, published: true })
    remote.complete()
    await publishReleaseAssets(input, remote.api)
    expect(remote.calls.every(value => value.method === 'GET')).toBe(true)
  })

  it('leaves an interrupted release unpublished, then resumes its already admitted files', async () => {
    const remote = github({ failUpload: 2 })
    await expect(publishReleaseAssets(input, remote.api)).rejects.toThrow('interrupted')
    expect(remote.release()?.draft).toBe(true)
    expect(remote.remote).toHaveLength(1)
    const before = remote.calls.length
    await publishReleaseAssets(input, remote.api)
    expect(remote.calls.slice(before).filter(value => value.method === 'UPLOAD')).toHaveLength(assets.length - 1)
    expect(remote.release()?.draft).toBe(false)
  })

  it('repairs only an empty starter left in its unpublished draft', async () => {
    const remote = github({ existing: true })
    remote.remote.push({ id: 99, name: assets[0]!.name, state: 'starter', size: 0 })
    await publishReleaseAssets(input, remote.api)
    expect(remote.calls.filter(value => value.method === 'DELETE')).toEqual([{ method: 'DELETE', path: '/repos/astrale-os/exp-codegraph/releases/assets/99' }])
  })

  for (const corruption of ['digest', 'size', 'missing', 'starter', 'extra']) {
    it(`never overwrites a published release with ${corruption} corruption`, async () => {
      const remote = github({ existing: true, published: true })
      remote.complete()
      if (corruption === 'digest') remote.remote[0]!.digest = `sha256:${'f'.repeat(64)}`
      if (corruption === 'size') remote.remote[0]!.size = 0
      if (corruption === 'missing') remote.remote.pop()
      if (corruption === 'starter') Object.assign(remote.remote[0]!, { state: 'starter', size: 0 })
      if (corruption === 'extra') remote.remote.push({ name: 'unexpected.gz' })
      await expect(publishReleaseAssets(input, remote.api)).rejects.toThrow()
      expect(remote.calls.every(value => value.method === 'GET')).toBe(true)
    })
  }

  it('rejects a pre-existing tag pointing at another source before any release mutation', async () => {
    const remote = github()
    remote.setReference({ object: { type: 'commit', sha: 'b'.repeat(40) } })
    await expect(publishReleaseAssets(input, remote.api)).rejects.toThrow('tag')
    expect(remote.calls.every(value => value.method === 'GET')).toBe(true)
  })
})
