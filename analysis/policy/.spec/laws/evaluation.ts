import { defineLaw } from '@astrale-os/codegraph/authoring'

export const POLICY_READ_ONLY = defineLaw({
  id: 'POLICY-READ-ONLY',
  statement:
    'A policy receives one immutable generation-pinned query and no transaction or store capability; its result cannot mutate the fact generation.',
})

export const POLICY_EVIDENCE_EPISTEMICS = defineLaw({
  id: 'POLICY-EVIDENCE-EPISTEMICS',
  statement:
    'Missing, partial, unavailable, or schema-incompatible required evidence produces an explicit indeterminate rule result and never a fabricated pass, failure, or negative match.',
})

export const POLICY_SCOPED_EVIDENCE = defineLaw({
  id: 'POLICY-SCOPED-EVIDENCE',
  statement:
    'A policy evaluating a globally partial scoped capability reports completeness for every rule; incomplete selected evidence may only be indeterminate and never supports pass or fail.',
})
