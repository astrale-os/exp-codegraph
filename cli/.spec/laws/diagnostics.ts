import { defineLaw } from '@astrale-os/codegraph/authoring'

export const CLI_DIAGNOSTIC_CAUSE_GROUPING = defineLaw({
  id: 'CLI-DIAGNOSTIC-CAUSE-GROUPING',
  statement:
    'Check presentation may coalesce diagnostics only when code, message, file, line, and column are equal; it retains every distinct projection pointer and never changes failure status.',
  tests: [
    {
      file: '../__tests__/cli-report.test.ts',
      id: 'CLI-DIAGNOSTIC-CAUSE-GROUPING',
    },
  ],
})

export const CLI_CHECK_JSON_OUTPUT = defineLaw({
  id: 'CLI-CHECK-JSON-OUTPUT',
  statement:
    'JSON check output is one versioned stdout document whose status, scope, diagnostic causes, exact occurrences, and check evidence reproduce the canonical text command outcome without diagnostic stderr.',
  tests: [{ file: '../__tests__/cli-v2.test.ts', id: 'CLI-CHECK-JSON-OUTPUT' }],
})

export const CLI_CHANGED_IMPACT_INFORMATIONAL = defineLaw({
  id: 'CLI-CHANGED-IMPACT-INFORMATIONAL',
  statement:
    'The changed-scope impact section lists, at file granularity, the laws whose attached test or code anchor file changed, the capabilities citing them directly or through other capabilities, and the changed modules that declare no law; it is derived on demand from descriptors alone, is printed when the scope falls back to the full catalog, and never changes the exit status.',
  tests: [
    {
      file: '../__tests__/law-impact.test.ts',
      id: 'CLI-CHANGED-IMPACT-INFORMATIONAL',
    },
  ],
})
