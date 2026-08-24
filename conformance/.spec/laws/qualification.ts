import { defineLaw } from '@astrale-os/codegraph/authoring'

export const CONFORMANCE_IMMUTABLE_AUTHORITIES = defineLaw({
  id: 'CONFORMANCE-IMMUTABLE-AUTHORITIES',
  statement:
    'Qualification consumes exact immutable specification and analysis identities and cannot mutate or replace either authority.',
})

export const CONFORMANCE_UNAVAILABLE_INDETERMINATE = defineLaw({
  id: 'CONFORMANCE-UNAVAILABLE-INDETERMINATE',
  statement:
    'Missing, partial, or unavailable required analysis evidence yields an explicit indeterminate outcome and never a fabricated match, mismatch, or pass.',
})

export const CONFORMANCE_FOCUS_ADVISORY = defineLaw({
  id: 'CONFORMANCE-FOCUS-ADVISORY',
  statement:
    'Focused qualification includes the complete declared profile dependency closure and remains advisory; only the unfiltered full plan has full-CI authority.',
})

export const CONFORMANCE_BIDIRECTIONAL_COVERAGE = defineLaw({
  id: 'CONFORMANCE-BIDIRECTIONAL-COVERAGE',
  statement:
    'Every rule reports forward authored-obligation coverage separately from inverse observed-surface coverage; neither direction may hide unmatched evidence in the other.',
})

export const CONFORMANCE_EXPLICIT_BINDING_AUTHORITY = defineLaw({
  id: 'CONFORMANCE-EXPLICIT-BINDING-AUTHORITY',
  statement:
    'Module surface qualification consumes one exact compiler binding from the authoritative specification namespace to the implementation entrypoint; it never substitutes an independently reconstructed implementation declaration graph or a legacy native fallback.',
})
