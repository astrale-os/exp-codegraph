# Astrale Codegraph

Codegraph is distributed from GitHub at an exact source revision. Its root package and four native
platform packages are private packing units qualified together as one GitHub Actions artifact; no
workflow publishes them to a package registry. See [GitHub artifact distribution](docs/github-artifacts.md).

`@astrale-os/codegraph` is a headless, extensible TypeScript code graph and specification
conformance engine. It exposes reusable analysis, persistence, repository, specification, and
policy modules; the `cg` command is one consumer of those APIs.

The optional specification authoring model is the convention-based module contract rooted by
`.spec/api.d.ts`. The package API, authoring primitives, viewer, and diagnostics are designed
around that model.

The live repository corpus has completed that cutover and the workspace qualification gate rejects
tracked or untracked obsolete specification anchors. Historical evidence remains inspectable as
non-normative context, but it is never interpreted as a second authoring model.

Repository discovery prunes generated `benchmark/artifacts` and `evidence/artifacts` snapshots,
plus archived `qualification/evidence`, before traversing them. These evidence trees remain
inspectable when opened as the catalog root. Explicit `--exclude` trees are likewise pruned during
discovery rather than loaded and filtered afterward.

## Start with the minimum

The only required artifact is the public TypeScript contract:

```text
module/
└── .spec/
    └── api.d.ts
```

Create it with:

```sh
cg init [module-directory]
```

Initialization never overwrites an existing contract and does not create empty optional folders.
If `api.d.ts` completely specifies the module, stop there.

## Complete module layout

```text
module/
├── .spec/
│   ├── api.d.ts
│   ├── code.ts
│   ├── icon.svg
│   ├── internal.d.ts
│   ├── schemas/
│   │   └── *.schema.json
│   ├── ports/
│   │   └── **/*.d.ts
│   ├── capabilities/
│   │   └── **/*.ts
│   ├── flows/
│   │   └── **/*.ts
│   ├── laws/
│   │   └── **/*.ts
│   ├── states/
│   │   └── **/*.ts
│   ├── limits.ts
│   ├── layout.ts
│   ├── examples/
│   │   └── **/*.ts
│   ├── benchmarks/
│   │   └── **/*.ts
│   ├── packages/
│   │   ├── <package-name>.ts
│   │   └── exceptions.ts
│   └── architecture.md
├── .history/
│   └── arbitrary explanatory files
├── src/
└── tests/
```

The `.spec/` grammar is closed. Unknown entries, wrong extensions, and symbolic links are errors.
Every optional artifact exists only when it expresses a material contract dimension better than
the artifacts already present.

`.history/` is intentionally open and non-normative. Markdown, text, JSON, YAML, PDFs, safe raster
images, and arbitrary binary files are detected for the viewer without being imported or executed.
Context diagnostics remain separate from contract validity, and context edits change only the
context revision. Context resources are read-only through the viewer editing protocol. A future PRD
or ARD representation may add semantics; filenames have no such meaning today.

Rendered `architecture.md` and Markdown context automatically link exact inline-code mentions such
as `API`, `Domain.open`, `connect()`, or `connect(options)` when they resolve unambiguously through
the module's compiler-derived public API and import graph. A call form must resolve to a callable;
collisions fail closed. Ordinary prose, fenced code, existing links, private names, and unresolved
names remain unchanged. The catalog projects links into the already-rendered safe HTML, so the
browser does not parse Markdown again. This presentation never rewrites Markdown source or makes
context normative.

An architecture document can render a canonical example without copying it into Markdown:

```md
<!-- spec:example ./examples/start-job.ts -->
```

The path must name an owned `.spec/examples/**/*.ts` file. The viewer renders that exact source as
a TypeScript block, while the normal specification compiler remains the single authority for its
strict no-emit and public-API-only checks. Context documents cannot include normative examples.

## Artifact ownership

| Artifact | Owns |
| --- | --- |
| `api.d.ts` | behavior provided to downstream consumers |
| `code.ts` | deliberate shared private entrypoints added to the inferred code boundary |
| `icon.svg` | optional visual identity used for this module in the specification viewer |
| `internal.d.ts` | internal architectural vocabulary required by the specification |
| `schemas/` | portable runtime value representations |
| `ports/` | behavior required from external substitutable providers |
| `capabilities/` | stable names for independently meaningful abilities |
| `flows/` | irreducible semantic orchestration |
| `laws/` | falsifiable semantic truths beyond the type system |
| `states/` | legal lifecycle transition topology |
| `limits.ts` | normative quantitative boundaries and measured budgets |
| `layout.ts` | intentional physical paths and their observation policy |
| `examples/` | canonical consumer intents through the public API |
| `benchmarks/` | stable performance workloads and metrics |
| `packages/` | reasons for direct external package dependencies |
| `architecture.md` | rationale, assumptions, non-goals, trust boundaries, and diagrams |

Tests remain outside `.spec/`; they are evidence rather than the contract itself.

## Public, internal, and required behavior

These boundaries are not interchangeable:

```text
api.d.ts       what consumers may ask the module to do
internal.d.ts  architectural concepts owned inside the module
ports/         behavior the module requires from a substitutable environment
```

Every Port file locally declares and exports exactly one named interface. Supporting imported
types and non-interface declarations are allowed. Default exports, re-export-only barrels,
multiple local interface exports, and duplicate qualified Port names are rejected.

Subdirectories establish presentation namespaces. For example:

```text
.spec/ports/authentication/identity-store.d.ts
```

may expose `authentication.IdentityStoreBackend`. The namespace never changes the TypeScript
contract. A Port describes the requirement, not a concrete adapter or package choice.

## Authoring primitives

Structured artifacts import tiny identity helpers from `@astrale-os/codegraph/authoring`. Files are
statically extracted and typechecked; the catalog never imports or executes them.

```ts
import {
  defineBenchmark,
  defineCapability,
  defineCode,
  defineLaw,
  defineLayout,
  definePackage,
  definePackagePattern,
  defineState,
} from '@astrale-os/codegraph/authoring'
```

### Semantic identifiers

Capabilities, laws, and benchmarks use stable hierarchical uppercase identifiers. Identifiers
describe meaning rather than order, and the exported constant mirrors the identifier:

```ts
import { defineLaw } from '@astrale-os/codegraph/authoring'

export const MUT_FAIL_UNCHANGED = defineLaw({
  id: 'MUT-FAIL-UNCHANGED',
  statement: 'A failed mutation leaves persistent state unchanged.',
})
```

Literal descriptor fields are closed, duplicate semantic identifiers are rejected across the
module, and benchmark capability references must resolve.

### State topology

The transition relation is the single source of truth:

```ts
import { defineState } from '@astrale-os/codegraph/authoring'

export const jobState = defineState({
  initial: 'pending',
  transitions: {
    pending: { start: 'running', cancel: 'cancelled' },
    running: { succeed: 'succeeded', fail: 'failed', cancel: 'cancelled' },
    succeeded: {},
    failed: {},
    cancelled: {},
  },
})
```

`StateOf`, `EventOf`, `NextStateOf`, `TransitionOf`, `InitialStateOf`, and `TerminalStateOf` derive
from that value. `transition` makes illegal flow transitions fail at specification compile time.
`statesOf`, `eventsOf`, `transitionsOf`, and `illegalTransitionsOf` let conformance tests enumerate
the finite relation without copying it. `initial` is optional; terminal states are derived from
states with no outgoing transitions. The viewer derives a Mermaid diagram from the same relation;
the diagram is a projection, never another transition authority.

Guards, permissions, side effects, and retries do not belong in the transition table. Put semantic
conditions in laws, operation ordering and effects in flows, and numeric bounds in `limits.ts`.

### Behavioral test evidence

Laws and states may attach exact Vitest declarations without moving tests into `.spec/`:

```ts
export const MUT_FAIL_UNCHANGED = defineLaw({
  id: 'MUT-FAIL-UNCHANGED',
  statement: 'A failed mutation leaves persistent state unchanged.',
  tests: [
    { file: '__tests__/mutation.test.ts', id: 'MUT-FAIL-UNCHANGED' },
  ],
})
```

The target test declaration carries the stable identity independently of its title:

```ts
/** @evidence MUT-FAIL-UNCHANGED */
it('a failed mutation preserves persistent state', async () => {})
```

Each file path is relative to the owning module. The catalog resolves the file and evidence ID
without importing or executing the test, rejects missing or duplicate IDs, distinguishes active
declarations from `skip` and `todo`, watches the file, and presents the exact declaration as
read-only evidence. Test files remain outside `.spec/` and inside the catalog root.

An attachment means the evidence declaration exists; it does not mean that the test runner passed.
Run attached evidence from the workspace root with `pnpm spec test`, select modules positionally
with `pnpm spec test shell runtime/query`, or run the changed module and its public-contract
consumers with `pnpm spec test changed [base]`. The command deduplicates declarations, groups files
by their owning package, and invokes the repository's standard `test:file` adapter sequentially.
Skipped and todo declarations are reported but never executed.

Attached evidence is focused feedback, not the full suite: `pnpm test` remains authoritative for
local and CI qualification. Omitting `tests` is valid and is shown as no test attached. For finite
state machines, conformance tests can additionally enumerate `transitionsOf` and
`illegalTransitionsOf` against an implementation-specific harness.

## TypeScript composition and dependency direction

All specification TypeScript is checked with strict, no-emit semantics. The checker also enforces
architectural direction:

- examples must import `../api.js` and may not import internals;
- API declarations may not reach into implementation source;
- relative cross-module imports must target another public `.spec/api.d.ts` contract;
- flows may compose API, internal, Port, state, law, capability, and limit artifacts;
- descriptor and package files remain closed literal modules;
- package-private import-map aliases and dynamic imports are not specification boundaries.

This permits a specification to compile before implementation exists while making drift between
its own artifacts visible immediately.

Exact implementation conformance treats generic parameters as scoped binders. Parameter spelling
may differ, while arity, nesting, shadowing, variance, constraints, defaults, and uses must remain
equivalent. `@conformance identity` is reserved for deliberately opaque contracts; it is not a
workaround for generic comparison.

### Shared private implementation entrypoints

Convention modules infer their TypeScript project, source root, and public entrypoint. When sibling
specified modules deliberately share one private implementation file, the owning module may add
that exact file without introducing a second manifest:

```ts
import { defineCode } from '@astrale-os/codegraph/authoring'

export default defineCode({
  internals: ['../capture-method.ts'],
})
```

`code.ts` cannot replace the inferred project, root, or public entrypoint. Internal paths remain
private, must be unique and contained by the inferred root, and do not permit other deep imports.

External type libraries form an isolation boundary. The API compiler projects only identities
named by type-only named, namespace, and default imports or by `import()` type references; it does
not open or normalize the dependency's declaration graph. Qualified exports such as `z.ZodType` and
`z.core.$ZodIssue`, generic arity, and `typeof` value identities are derived from authored syntax.
External runtime imports, star exports, and ambient package type-reference directives reject
explicitly. Normal catalog compilation runs this projection in a disposable process with a memory
limit and deadline, and an unexpected TypeScript project-analysis exception becomes an attributable
diagnostic rather than terminating the catalog build. Installed packages are still typechecked by
the module composition pass; identity projection is not a claim that an uninstalled package really
exports a named type.

## JSON Schemas

Every schema is validated as JSON Schema Draft 2020-12. Convention-profile schemas form one closed
catalog-local schema set: relative references and references to another discovered stable `$id`
resolve without network access; missing references and duplicate `$id` values fail.

JSON Schema owns portable structural admissibility. Contextual or state-dependent requirements
remain laws and flows. If the same shape is represented in TypeScript and JSON Schema, projects
should generate or mechanically compare one representation from the other rather than silently
maintaining two authorities. The tooling does not infer an unsafe name-based equivalence.

## External packages

One file justifies one external package and deliberately omits its version:

```ts
import { definePackage } from '@astrale-os/codegraph/authoring'

export default definePackage({
  package: 'jose',
  purpose: 'Provides standards-compliant credential signing and verification.',
})
```

The path encodes the package name:

```text
packages/jose.ts              -> jose
packages/@noble/hashes.ts     -> @noble/hashes
```

Across every module specification owned by one package, these files are authoritative over its
non-workspace runtime-bearing dependencies in `dependencies`, `peerDependencies`, and
`optionalDependencies`. `devDependencies` are deliberately outside package-spec authority: build,
test, lint, and other development tooling never require package specifications. CI reports:

- a manifest dependency with no exact package file or matching exception;
- a stale package file;
- a stale or duplicate pattern;
- duplicate package ownership across sibling module specs;
- a package definition without an owning `package.json`.

`workspace:` dependencies are module-to-module relationships, not external package choices, and
are excluded. Version changes do not change specification identity; changing the dependency set
does change verification identity.

`packages/` is therefore optional when the owning package has no direct runtime-bearing external
dependencies, but each such dependency makes either an exact package file or a justified matching
exception a conditional conformance requirement. This does not change `api.d.ts` as the structural
minimum.

Pattern exceptions are narrow, terminal-wildcard escape hatches with required reasons:

```ts
import { definePackagePattern } from '@astrale-os/codegraph/authoring'

export default [
  definePackagePattern({
    pattern: '@types/*',
    reason: 'Ambient type packages for explicitly supported development environments.',
  }),
]
```

## Physical ownership layout

`layout.ts` is optional. Add it only when the physical decomposition of implementation code is
intentional enough to declare. The shorthand form is a sparse, module-root-relative path list:

```ts
import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout([
  'src/',
  'src/value.ts',
  'src/slug.ts',
  'src/backend/',
  'src/backend/read.ts',
  'src/backend/write.ts',
])
```

Paths are canonical POSIX paths relative to the module directory. Directory paths end in `/`, and
every parent directory has its own explicit entry. `.spec/` and `.history/` are outside this
artifact and cannot be declared. The module root is implicit and must not appear as a synthetic
`./` entry.

Every declared path must physically exist with the right kind. Undeclared descendants are observed
but do not fail a sparse list, keeping the artifact focused on intentional boundaries rather than
making it an implementation inventory. Use the configured form when every non-ignored path in the
complete module root should be declared:

```ts
export default defineLayout({
  entries: ['src/', 'src/index.ts'],
  exact: true,
  ignore: ['src/generated/**'],
})
```

Ignore patterns are canonical module-relative POSIX globs supporting `*`, `**`, and `?`. Explicit
layout entries override matching ignores, so an intentionally governed test, generated file, or
mixed-language asset remains strict. The effective defaults omit common test material:

```text
**/.check-workspace.cjs
**/__tests__/**
**/tests/**
**/*.test.*
**/*.spec.*
```

## Module icon

Add `.spec/icon.svg` when the module needs a recognizable identity in the specification explorer.
Without it, the viewer uses its default module glyph; organizational folders keep their folder
glyph. A folder that owns a module specification uses that module's icon while still expanding its
child modules.

Icons are presentation metadata: changing one refreshes the catalog, but does not change the API or
semantic verification revision. The catalog admits one UTF-8 SVG of at most 8 KiB with a finite,
positive `viewBox`. It accepts a bounded drawing subset and rejects scripts, event handlers, text,
embedded documents or images, external references, and executable URLs. The viewer receives only
the admitted element tree, never authored markup.

```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
  <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
  <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
</svg>
```

Repository-standard generated, local, secret, and build material remains outside observation.
Authored ignore patterns extend the defaults. Adding, changing, or removing an ignored physical
file does not change layout evidence because ignored paths are never observed.

The viewer renders the result as a compact ownership tree. Effective ignore patterns appear as a
small footer below the tree only when at least one pattern exists. Green nodes match the
implementation, yellow nodes are declared but missing, blue nodes are neutral sparse-map
observations, and red nodes are undeclared under an exact map or have the wrong physical kind.
Missing and mismatched declared paths always fail; additional paths fail only in exact mode.
Filesystem observation changes verification identity without changing the normative specification
revision.

## Implementation conformance

The specification can exist before code. When tooling finds an unambiguous implementation source
and an owning `tsconfig.json`, it binds conformance automatically:

1. a source entrypoint selected by the module package's root export, when present;
2. otherwise the canonical `src/index.*` entrypoint;
3. otherwise a root `index.*` entrypoint.

Equal-authority candidates are diagnosed instead of guessed. The existing exact TypeScript module
verifier then compares the public declaration contract and implementation in both directions,
including exports, declarations, members, callables, dependencies, package boundaries, and deep
imports. Typechecking alone is not considered conformance.

Compiler diagnostics attached to a module are scoped to its bound implementation roots. Project
configuration, option, and global diagnostics remain visible, as do syntax and type errors in
owned source. Errors in imported or sibling source belong to that source's owning module, while
package-wide declaration emission remains the package build's responsibility. This keeps
conformance diagnostics attributable without weakening the exact public-surface comparison.

The package contract allows every dependency justified by the package specification. Legacy
manifest package allowlists retain their stricter observed-use rule.

## Viewer and revisions

The browser viewer exposes first-class views for every populated artifact. Declaration sources are
content-addressed; structured descriptors are presented semantically with their source retained.
Markdown is rendered from inert escaped content. PDFs and images are served only when their source
and digest match a currently catalogued context resource. Verification and streaming use the same
no-follow file handle, and embedded PDFs run in a sandbox; PDFs support byte ranges. Unknown binary
context is download-only.

Law statements and formal expressions link exact, case-sensitive API declaration mentions to their
canonical owner. Qualified exports and members are resolved as a whole; ambiguous names remain
plain text instead of being guessed. This non-normative projection is computed once per immutable
catalog payload and transported as pre-resolved text spans, so the browser never rescans laws when a
view renders. Formula markup is cached in a bounded client-side cache and accepts only those
catalog-generated internal links.

Normative `.spec/`, explanatory `.history/`, implementation evidence, and package dependency sets
have separate revision roles. Context edits never invalidate the semantic contract or code
verification cache. A code or TypeScript-project change does invalidate implementation evidence
even when the public contract and code-analysis summary remain textually unchanged.

Loaded specifications contain authored and statically derived specification truth only. The
catalog owns mutable evaluation evidence: effective package dependencies, compiled conformance
contracts, code analysis, and verification results. Code analysis and verification consume narrow
catalog views instead of importing the catalog assembly layer, so the context dependency graph
stays acyclic without giving up compiler-project or content caches.

## Commands

```sh
cg init [module-directory]
cg check [root] [--select <relative-path>]... [--exclude <relative-path>]... [--require-complete-layout] [--require-exact-layout] [--format <text|json>] [--no-cache]
cg changed [root] [base] [--scope-only] [--no-cache]
cg test [module-path]... [--root <directory>] [--no-cache]
cg test changed [base] [--root <directory>] [--no-cache]
cg verify [root] [--select <relative-path>]... [--require-pass] [--details]
cg dev [root] [--port 4173] [--open] [--verify] [--no-cache]
```

`--select` is repeatable and is resolved from the command root. It quickly checks only matched
convention modules, their transitive public-contract dependencies, and relevant TypeScript project
evidence. Catalog-wide package and schema authority remains the full `check` gate. An unavailable
support contract is reported once as the causal dependency failure instead of cascading
declaration mismatches through every selected consumer. When a declared dependency is actually
missing from the installed package tree, verification likewise emits one
`WORKSPACE_DEPENDENCIES_UNAVAILABLE` diagnostic at the owning `package.json` and suppresses derived
surface and identity comparisons for that incoherent project. Invalid imports from an installed
package retain their normal TypeScript diagnostics.

From the kernel workspace root, `pnpm spec:check:module <path>` and
`pnpm spec:verify:module <path>` keep the repository as the catalog/project root while selecting the
named module. Passing a module directory as the command root instead creates a genuinely isolated
catalog and is appropriate only when that directory owns its TypeScript project.

`changed` discovers committed branch changes plus staged, unstaged, and untracked work, maps them
to the nearest convention modules, and includes their public-contract consumers plus the dependency
support needed to typecheck that affected closure. Its base defaults to
`GITHUB_BASE_REF` or `SPEC_BASE`, then the nearest remote branch already contained by `HEAD`; this
avoids comparing a long-lived branch against an unrelated remote default. Pass a base as the second
positional argument only when repository ancestry cannot express the intended target. The resolved
base and scope are always printed. Specification tooling, TypeScript configuration, package
manifests, catalog schema/package authority, deleted anchors, and legacy-owned changes automatically
fall back to the full catalog check.
Use `--scope-only` to inspect that resolution without starting the check; the default still performs
fast affected structural and type feedback. Repository-specific wrappers may append inexpensive
global checks such as stale version-reference validation. This local path is advisory: the
unselected full `check`, including catalog-wide schema and package authority, remains the CI
qualification gate.

`test` resolves the same module paths without `--select` ceremony. With no paths it runs all active
attached evidence; with positional paths it runs those modules; `test changed` runs direct changed
owners plus downstream public-contract consumers while excluding upstream support-only modules.
It never substitutes for the unselected repository test command, and its final line says so.

Checks print line-oriented phase and module progress by default and always end with one stable
count summary. Focused summaries distinguish selected modules from loaded public-contract support.
`--quiet` suppresses progress while retaining scope, diagnostics, and the final summary.

Text diagnostics report one exact source cause once and summarize additional specification
projections when only their pointer differs. The final count distinguishes causes from projection
occurrences. Use `cg check --format json` for one versioned, machine-readable report on stdout;
diagnostic groups retain every distinct pointer and stderr remains empty for an ordinary completed
check. Argument and operational failures still use the normal CLI error channel and exit status.

Verification groups failing obligations by specification, profile, and diagnostic code by default;
passing profiles and serialized expected/actual type graphs stay out of routine output. Add
`--details` to the same command when the complete comparison evidence is needed.

`--require-complete-layout` requires a `layout.ts` declaration. `--require-exact-layout` additionally
requires selected module layouts to use `exact: true`; exact layouts implicitly govern the complete
module root. This provides a focused migration gate without forcing unrelated sparse layouts to
migrate in the same change.

`check` discovers both profiles, validates and composes every artifact, checks package and schema
catalog authority, and reports stable source diagnostics.

Local `check` and `changed` commands automatically restore bounded, content-validated compiler
evidence before building the catalog and persist the next reusable snapshot afterward. Discovery,
layout observation, schema and package authority, diagnostics, summaries, and repository-specific
global checks still run fresh. Continuous-integration environments automatically bypass persistent
evidence, keeping the unselected full check an independent cold qualification oracle. Use
`--no-cache` locally only when diagnosing cache behavior or comparing cold and warm execution.

Catalog assembly inventories convention modules once, submits declaration resources in bounded
isolated batches, and shares TypeScript Programs across small safe module groups. Script-style
sources and global or external module augmentations retain independent Programs so batching cannot
change their compiler environment. The analysis cache retains one catalog wave without retaining
Programs; declaration workers remain capped at four 256 MiB heaps. Kernel check entrypoints also
bound the parent Node heap at 1280 MiB so faster batching does not become unbounded memory growth.
The interactive `pnpm spec` launcher uses a 2048 MiB ceiling because the viewer retains the current
browser catalog while rebuilding; this remains a ceiling, not a target.
Every isolated compiler child also carries `--codegraph-worker=<role>` in its process arguments so
operational sampling can distinguish API compiler, application binding, and specification
TypeScript workers without guessing from built script paths.

`verify` additionally compares every bound API and implementation. A spec-only module is valid but
is not counted as a conformance pass; `--require-pass` requires every discovered specification to
have passing implementation evidence.

`dev` serves the shared viewer on loopback and watches profile topology, declared resources,
context, package intent, TypeScript projects, implementation sources, and verification evidence.
Source-like implementation files rebuild on content or topology changes, while declared non-code
layout paths rebuild only when they are added or removed. Generated distributions, caches, logs,
and benchmark, evidence, or qualification run artifacts are rejected before semantic invalidation.
It prints an initialization line immediately and the stable `SPEC_SERVER_URL` when listening.
It shares the local catalog-evidence cache used by `check`, so an unchanged restart avoids
rebuilding TypeScript Programs. Cache files are private, compressed, atomic, scoped by the real
catalog root and toolchain, limited to 24 MiB per root and 64 MiB across at most eight roots, and
never contain TypeScript Programs. Persistence runs only after catalog activity becomes idle and an
unchanged rebuild does not rewrite the cache; a new rebuild waits for an already-started save rather
than overlapping its serialization with compiler work. Missing, stale, incompatible, oversized, or
corrupt evidence is a normal cache miss. Use `--no-cache` only when diagnosing cache behavior.

## Legacy retirement boundary

No live module is allowed to return to manifest authoring. The workspace `spec:check` and
`spec:check:changed` wrappers end with a deterministic legacy-anchor check over tracked, staged,
unstaged, and non-ignored untracked files.

The internal reader cannot yet be deleted without a separate public catalog-transport change:
historical snapshots can still be opened explicitly, and exported catalog payload types still
admit their legacy representation. Normal repository discovery excludes `.history/`,
`qualification/evidence/`, and generated evidence or benchmark artifact trees, so those snapshots
cannot become live specifications accidentally. Removing the reader requires versioning that
transport/readability consequence rather than treating the code as unreachable.

## Trust boundary

Specification and context data are never executed. Static descriptor extraction accepts only the
documented literal authoring forms. Symbolic links, path escapes, unknown normative artifacts,
remote schema resolution, arbitrary browser origins, unlisted editing targets, and stale context
digests are rejected. Unsupported evidence becomes an explicit diagnostic rather than being
silently omitted.
