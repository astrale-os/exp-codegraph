import { defineLaw } from '@astrale-os/codegraph/authoring'

export const REPOSITORY_RETAIN_EVIDENCE = defineLaw({
  id: 'REPOSITORY-RETAIN-EVIDENCE',
  statement:
    'Classification affects query and projection scope but never removes an in-scope file or relationship from the underlying inventory generation.',
})

export const REPOSITORY_ORTHOGONAL_CLASSIFICATION = defineLaw({
  id: 'REPOSITORY-ORTHOGONAL-CLASSIFICATION',
  statement:
    'Purpose, provenance, lifecycle, and delivery remain independent dimensions with attributable evidence; none is derived solely from another.',
})

export const REPOSITORY_UNKNOWN_IS_VISIBLE = defineLaw({
  id: 'REPOSITORY-UNKNOWN-IS-VISIBLE',
  statement:
    'When classification cannot be proved, the file remains visible as unknown rather than being silently treated as implementation or excluded.',
})
