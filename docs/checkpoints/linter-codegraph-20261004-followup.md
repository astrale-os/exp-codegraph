# SDK / Codegraph checkpoint follow-up — 4 October 2026

The retained production checkpoint remains SDK `202d3b0a` and Codegraph `304f23b9`. This follow-up adds evidence and cleanup documentation only. The original checkpoint tag remains unchanged. Initial baselines remain SDK `cad2f224` and Codegraph `f35484f`.

## Measured progress

The serial initial/current/current/initial Operations pilot used the same copied project, provider world and Node 26.5.1, with default budgets. Two samples per version give these exploratory medians:

| Usage | Initial | Checkpoint | Initial/checkpoint ratio |
| --- | ---: | ---: | ---: |
| Cold, process launch to first complete report | 30.90 s | 1.85 s | 16.70× |
| Identifier edit | 2.80 s | 0.75 s | 3.74× |
| Query body edit | 4.46 s | 0.78 s | 5.73× |
| No change | 0.316 s | 0.403 s | 0.784×; current about 27% slower |

Warm timings measure the resident API call after the actual edit, excluding the write. These are one-project observations with few repetitions and substantial variation; macOS fseventsd was busy. They do not establish performance acceptance or a global 10× gain. RSS was not measured.

Independent review verified 24 complete reports against their own version oracles and eight source restorations. Strict cross-version equality fails only on the preserved `policyDigest` change from two deliberate false-positive fixes. The digest is not normalized. Captured 3,071 artifact files and both native binaries retain their hashes after cleanup; this does not recensus uncaptured dependencies or qualify an isolated consumer installation.

Current diagnostic instrumentation preserved eight complete reports and counted 11,997 fresh Stat-kind cells across 1,910 parents per fresh publication. Perfect one-call-per-parent substitution would give at most 6.28× fewer operations in that family, before fallbacks and other work. This is not a syscall or latency estimate. Bulk-directory substitution remains unimplemented because metadata, symlink, permission, error and temporal equivalence are unproved.

Lean 4.34.0 checked eight printed authority theorems without axioms. The source hash is `056d3882f0527d3ccda7c593c41b0260bae9f222bc44bebc9263db16741e9b0e`. The finite observation/refinement model makes its authority assumptions explicit; it proves no Go, OS, compiler, watcher or performance property. Situational proof sources and raw domain reports remain local.

## Completed cleanup

All 16 remaining registered historical linter/perf worktrees have been removed, following the earlier eight removals. Two auxiliary unregistered trees, including a schema prototype without Git metadata, were also archived and removed. There are no registered worktrees under the old linter/perf source paths.

Eighteen new archives were checked for complete included source bytes, permissions and links. Tracked `dist` files and private native candidate payloads are preserved. Staged and unstaged binary patches and index backups retain experimental changes. Two full Git bundles were restored into fresh bare repositories, proving all recorded branch and detached HEAD commits exist. Original permissions are in the archives; read-only proof directories required temporary owner-write permission for deletion. The protected-directory failure and recovery receipts remain local.

Generated dependency links and caches are excluded. Initial/current benchmark fixtures, artifacts, toolchains, the ledger, and evidence outside the obsolete worktrees remain. Two preexisting broken private-host `.bin` links now target the active checkpoint dependencies. Older absolute source paths require restoration from an archive before rerunning their historical commands.

The additional cleanup saved **2.15 GiB** of allocated directory size across the perf and consolidation directories, after counting the new archives. This is a `du -sk` measurement, not an APFS physical free-space guarantee. Local archives live under `astrale/.worktrees/linter-consolidation-20261004/archives/20261004-final`.

The original SDK's 37 preexisting status rows, file contents, modes and links are unchanged. The 44 `deploy-v4` SDK worktrees remain outside this cleanup. SDK now has 46 registrations (original, checkpoint and those 44); Codegraph has two (original and checkpoint). Archive manifests and bundle hashes are in the adjacent JSON; experimental source archives are local, not deployed or merged.

## Remaining work

The full SDK suite still has 1,749 passes and one directory-membership watcher failure; isolated repeats remain unstable. Public package/dependency/native asset closure and isolated consumer installation remain open. There is no proven permanent FD leak fix.

The measured noop regression needs attention. Next, profile current warm/noop wall time, CPU and RSS under known observer overhead, then change dependency footprints or producer authority only when exact report correspondence is demonstrated. Extend initial/current comparisons to the frozen twelve-project set. The net production delta remains **+24,282 lines**; neither the requested net 10,000-line reduction nor cold-and-warm global 10× is achieved.

See [machine-readable progress and archive inventory](linter-codegraph-20261004-followup.json) and the [original checkpoint](linter-codegraph-20261004.md).
