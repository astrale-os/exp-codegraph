import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: [
    'UPSTREAM.md',
    'index.ts',
    'lifecycle/',
    'lifecycle/leases.ts',
    'lifecycle/retention.ts',
    'materialization/',
    'materialization/model.ts',
    'materialization/read.ts',
    'materialization/validate.ts',
    'materialization/write.ts',
    'query/',
    'query/cursor.ts',
    'query/filter.ts',
    'query/pinned.ts',
    'query/snapshot-set.ts',
    'schema/',
    'schema/integrity.ts',
    'schema/migrate.ts',
    'schema/schema.ts',
    'store.ts',
  ],
  exact: true,
})
