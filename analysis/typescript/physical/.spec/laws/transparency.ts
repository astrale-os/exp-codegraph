import { defineLaw } from '@astrale-os/codegraph/authoring'

export const TYPESCRIPT_BODY_PHYSICAL_TRANSPARENCY = defineLaw({
  id: 'TYPESCRIPT-BODY-PHYSICAL-TRANSPARENCY',
  statement:
    'Body-local ordinals, dictionaries, shared source defaults, and compact identities are a versioned private encoding below FunctionBodyIR; decoding reconstructs the exact semantic payload and semantic identity is computed before packing.',
})
