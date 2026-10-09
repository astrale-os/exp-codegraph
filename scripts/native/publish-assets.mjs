import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repository = 'astrale-os/exp-codegraph'
const base = `/repos/${repository}`

/** Upload admitted files once; an interrupted draft resumes without replacing published bytes. */
export async function publishReleaseAssets({ packageVersion, sourceRevision, assets }, api) {
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(packageVersion) || !/^[a-f0-9]{40}$/u.test(sourceRevision)) {
    throw new Error('External artifacts require an exact version and source revision.')
  }
  const tag = `codegraph-v${packageVersion}-${sourceRevision}`
  const names = new Set()
  for (const asset of assets) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(asset.name) || names.has(asset.name) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || !/^[a-f0-9]{64}$/u.test(asset.sha256)) {
      throw new Error('External assets are not a unique admitted file inventory.')
    }
    names.add(asset.name)
  }
  if (!names.has('native-release.json') || !names.has('viewer-release.json')) throw new Error('Both release headers are required.')
  await admitTag(api, tag, sourceRevision, true)
  let release = await findRelease(api, tag)
  if (!release) {
    release = await api('POST', `${base}/releases`, {
      tag_name: tag, target_commitish: sourceRevision, name: `Codegraph ${packageVersion} artifacts (${sourceRevision.slice(0, 12)})`,
      body: `Source: ${sourceRevision}\nNative and viewer assets for the single npm package. Checksums are pinned by its release headers.`,
      draft: true, prerelease: true, make_latest: 'false',
    })
  }
  if (!Number.isSafeInteger(release.id) || release.tag_name !== tag || release.target_commitish !== sourceRevision || release.prerelease !== true) {
    throw new Error('Existing artifact release does not belong to the admitted source.')
  }
  const remote = await api('GET', `${base}/releases/${release.id}/assets?per_page=100`)
  if (!Array.isArray(remote) || remote.some(asset => !names.has(asset.name)) || new Set(remote.map(asset => asset.name)).size !== remote.length) {
    throw new Error('Artifact release contains unexpected or duplicate files.')
  }
  for (const asset of assets) {
    const previous = remote.find(item => item.name === asset.name)
    if (previous) {
      if (previous.state === 'starter' && previous.size === 0 && release.draft) {
        // GitHub can leave an empty starter after a failed upload. Only our unpublished draft is repaired.
        await api('DELETE', `${base}/releases/assets/${previous.id}`)
      } else {
        admitRemoteAsset(previous, asset)
        continue
      }
    } else if (!release.draft) {
      throw new Error(`Published artifact release is missing ${asset.name}; it cannot be repaired by replacement.`)
    }
    admitRemoteAsset(await api('UPLOAD', `${base}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, asset), asset)
  }
  const completed = await api('GET', `${base}/releases/${release.id}/assets?per_page=100`)
  if (completed.length !== assets.length) throw new Error('Artifact release is not complete.')
  for (const asset of assets) admitRemoteAsset(completed.find(item => item.name === asset.name), asset)
  if (release.draft) release = await api('PATCH', `${base}/releases/${release.id}`, { draft: false, prerelease: true, make_latest: 'false' })
  if (release.draft || release.tag_name !== tag) throw new Error('Artifact release is not public.')
  await admitTag(api, tag, sourceRevision, false)
  return { tag, sourceRevision, packageVersion, releaseId: release.id, assets: assets.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) }
}

function admitRemoteAsset(actual, expected) {
  if (!actual || actual.name !== expected.name || actual.state !== 'uploaded' || actual.size !== expected.bytes || actual.digest !== `sha256:${expected.sha256}`) {
    throw new Error(`Release asset ${expected.name} differs from the admitted bytes; existing bytes will not be overwritten.`)
  }
}

async function admitTag(api, tag, sourceRevision, optional) {
  let reference = await api('GET', `${base}/git/ref/tags/${tag}`, undefined, true)
  if (!reference && optional) return
  if (reference?.object?.type === 'tag') reference = { object: (await api('GET', `${base}/git/tags/${reference.object.sha}`)).object }
  if (reference?.object?.type !== 'commit' || reference.object.sha !== sourceRevision) throw new Error('Artifact tag does not point to the admitted source revision.')
}

async function findRelease(api, tag) {
  const published = await api('GET', `${base}/releases/tags/${tag}`, undefined, true)
  if (published) return published
  // The by-tag endpoint excludes drafts. List authenticated drafts to resume an interrupted upload.
  for (let page = 1; ; page++) {
    const releases = await api('GET', `${base}/releases?per_page=100&page=${page}`)
    const draft = releases.find(value => value.tag_name === tag)
    if (draft) return draft
    if (releases.length < 100) return undefined
  }
}

function githubAPI(token) {
  return async (method, path, body, allowMissing = false) => {
    const upload = method === 'UPLOAD'
    const response = await fetch(`https://${upload ? 'uploads' : 'api'}.github.com${path}`, {
      method: upload ? 'POST' : method,
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
        ...(body ? { 'Content-Type': upload ? 'application/octet-stream' : 'application/json' } : {}),
        ...(upload ? { 'Content-Length': String(body.bytes) } : {}),
      },
      ...(body ? { body: upload ? createReadStream(body.path) : JSON.stringify(body) } : {}),
      ...(upload ? { duplex: 'half' } : {}),
    })
    if (response.status === 404 && allowMissing) return undefined
    if (!response.ok) throw new Error(`GitHub artifact ${method} failed (${response.status}); exact-source release requires Contents write and, for changed workflows, Workflows write.`)
    return response.status === 204 ? undefined : response.json()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0] !== '--directory' || args[2] !== '--source-revision') throw new Error('Usage: publish-assets.mjs --directory directory --source-revision sha')
  const directory = resolve(args[1])
  const native = JSON.parse(await readFile(resolve(directory, 'native-release.json'), 'utf8'))
  const viewer = JSON.parse(await readFile(resolve(directory, 'viewer-release.json'), 'utf8'))
  const { admitExternalReleaseAssets } = await import('./admit-packages.mjs')
  const assets = await admitExternalReleaseAssets({ directory, native, viewer, sourceRevision: args[3], packageVersion: native.packageVersion })
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required to publish admitted external artifacts.')
  const result = await publishReleaseAssets({ packageVersion: native.packageVersion, sourceRevision: args[3], assets }, githubAPI(process.env.GH_TOKEN))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
