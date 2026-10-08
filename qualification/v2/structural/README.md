# Structural inspection qualification

[Validated checkpoint and scope](RESULTS.md)

This consumer answers “who uses this API?” and “what depends on this file?”
through the public TypeScript semantic reader. It does not parse source, create
a TypeScript program, or maintain its own semantic index. The project fixture
has no `.spec/` directory, module declarations, or body extraction requirement.

`oracle.ts` is qualification infrastructure only. It creates an independent
TypeScript Compiler program, resolves aliases and shorthand value symbols, and
records identifier and module-specifier offsets. Its answers are compared with
the public reader, including import/export aliases, barrels, namespaces, type
references, type-only imports, literal dynamic imports, unresolved imports,
and cycles.

Incremental qualification adds a reference after a complete empty query,
changes a source revision, and deletes a referring file. Every current answer
is compared with a newly opened compiler project and the independent oracle;
the original snapshot must retain its original evidence.

Run the consumer qualification against the exact candidate native binary:

```sh
node qualification/v2/structural/qualify.ts --native-binary /absolute/path/to/codegraph-native
```

The durable regression suite is
`__tests__/typescript-structural-inspection.test.ts`. Set
`CODEGRAPH_TEST_NATIVE_BINARY` to that same candidate when running it. The
qualification consumer has its own typecheck configuration at
`qualification/v2/structural/tsconfig.json`.

Real-project calibration can copy the existing
`domains/services/utils/http-readiness/{accept,index}.ts` files into a temporary
file project. These files have no external imports and exercise an actual API
and its barrel without changing the Domain repository. Broader calibration of
the original Services project must be read-only and preserve its package
imports and pinned compiler configuration. The 1Pact evidence snapshots are
not modified by this qualification.

```sh
node qualification/v2/structural/qualify.ts --native-binary /absolute/path/to/codegraph-native --calibrate-http-readiness /absolute/path/to/domains/services/utils/http-readiness
```

`packed-consumer.mjs` extracts a built root tarball into an isolated consumer,
links ordinary dependencies from the qualified offline dependency tree, checks
the public declarations without source aliases, and runs the public JavaScript
API with an explicit native override. Its report records both artifact hashes.
This qualifies the packed API; it does not qualify every platform's native
release package.

```sh
node qualification/v2/structural/packed-consumer.mjs --package /absolute/path/to/codegraph.tgz --native-binary /absolute/path/to/codegraph-native
node qualification/v2/structural/repeat-edits.ts --native-binary /absolute/path/to/codegraph-native --edits 24
```

The repeat-edit qualification compares every edit with the independent oracle,
checks a cache hit after each refresh, disposes current snapshots, and verifies
deletion against a cold project while retaining the original snapshot. Node and
native-session RSS samples are observational evidence with no machine-specific
threshold. Node memory includes the qualification oracle as well as Codegraph.
