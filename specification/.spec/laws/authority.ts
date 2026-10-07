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

export const SPECIFICATION_COMPILER_WORK_OBSERVABILITY = defineLaw({
  id: 'SPECIFICATION-COMPILER-WORK-OBSERVABILITY',
  statement:
    'Batch compilation reports actual declaration sessions, compiler Programs, retries, compatibility fallbacks, worker peak-residency bounds, and the measured TypeScript tail after snapshot scheduling; observation failure cannot change a normative snapshot or diagnostic.',
  tests: [
    {
      file: '../__tests__/specification-snapshot.test.ts',
      id: 'SPECIFICATION-COMPILER-WORK-OBSERVABILITY',
    },
  ],
})

export const SPECIFICATION_CAPABILITY_CITATIONS_DESCEND = defineLaw({
  id: 'SPECIFICATION-CAPABILITY-CITATIONS-DESCEND',
  statement:
    'A capability citation resolves only to a law or capability declared by the citing module or by a specified strict descendant module; an unresolved citation, a repeated citation, and a capability that reaches itself through capabilities are specification diagnostics.',
  tests: [
    {
      file: '../__tests__/capability-derivation.test.ts',
      id: 'SPECIFICATION-CAPABILITY-CITATIONS-DESCEND',
    },
  ],
})

export const SPECIFICATION_CAPABILITY_STATUS_DERIVED = defineLaw({
  id: 'SPECIFICATION-CAPABILITY-STATUS-DERIVED',
  statement:
    'A capability status is derived and never authored, stored, or diagnosed: declared when the capability cites nothing, held when every cited law has an active attached test and every cited capability is held, and partial otherwise.',
  tests: [
    {
      file: '../__tests__/capability-derivation.test.ts',
      id: 'SPECIFICATION-CAPABILITY-STATUS-DERIVED',
    },
  ],
})
