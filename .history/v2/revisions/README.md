# TypeSpec V2 revision record template

Create one file named `<REVISION-ID>.md` with this structure:

```md
# <REVISION-ID>: <title>

Status: proposed

Date: YYYY-MM-DD

Affected requirements: REQ-ID, REQ-ID

Review perspectives: TypeSpec product, analysis/native, consumer/DX, qualification

## Existing decision

## Proposed decision

## Evidence and motivation

## Alternatives

## Compatibility, migration, and gate effects

## Objections and dispositions

## Consensus and decision
```

Only `accepted` revisions may change ratified requirement semantics or mark a row `superseded` or
`deferred`. The revision remains append-only after acceptance except for links to later evidence or
a superseding revision.
