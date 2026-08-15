import { defineLaw } from '@astrale-os/codegraph/authoring'

export const NATIVE_DISTRIBUTION_FAIL_CLOSED = defineLaw({
  id: 'NATIVE-DISTRIBUTION-FAIL-CLOSED',
  statement:
    'Native analysis resolves only an explicit application-controlled executable or the exact current-target artifact admitted by versioned root and artifact manifests; missing, corrupt, mismatched, non-executable, downloaded, or implicitly built binaries fail before spawn.',
})

export const NATIVE_ARTIFACTS_ARE_OPAQUE = defineLaw({
  id: 'NATIVE-ARTIFACTS-ARE-OPAQUE',
  statement:
    'Platform artifact packages contain no importable API, dependency, lifecycle build, compiler, or semantic policy; @astrale-os/codegraph remains the sole supported consumer library and CLI.',
})
