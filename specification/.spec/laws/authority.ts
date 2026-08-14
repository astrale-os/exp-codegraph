import { defineLaw } from '@astrale-os/codegraph/authoring'

export const SPECIFICATION_NORMATIVE_ONLY = defineLaw({
  id: 'SPECIFICATION-NORMATIVE-ONLY',
  statement:
    'A SpecificationSnapshot contains authored normative meaning only; implementation bindings, resolved tests, filesystem observations, qualification, history, and presentation remain independent authorities.',
})

export const SPECIFICATION_STATIC_LANGUAGE = defineLaw({
  id: 'SPECIFICATION-STATIC-LANGUAGE',
  statement:
    'Specification sources are parsed as a closed static language and are never imported or executed; descriptor calls resolve only to the authoring helper imported from the canonical package identity.',
})

export const SPECIFICATION_CONTENT_IDENTITY = defineLaw({
  id: 'SPECIFICATION-CONTENT-IDENTITY',
  statement:
    'A snapshot identity is a deterministic digest of normalized authored resources, static diagnostics, and portable coordinates; non-normative context cannot change it.',
})
