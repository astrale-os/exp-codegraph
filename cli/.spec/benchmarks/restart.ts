import { defineBenchmark } from '@astrale-os/codegraph/authoring'

export const CODEGRAPH_CLI_RESTART = defineBenchmark({
  id: 'CODEGRAPH-CLI-RESTART',
  statement:
    'Bounds whole and selected cg check journeys across distinct unchanged operating-system processes.',
  workload:
    'Prime one isolated shared Kernel cache, then interleave at least five fresh-process whole, leaf, dependency-heavy, and multi-select checks after each request has a canonical prime.',
  metrics: [
    'duration',
    'p95-duration',
    'process-id',
    'installed-package-fingerprint',
    'output-digest',
    'checkpoint-manifest-digest',
    'repository-inventory',
    'application-snapshot',
    'exit-status',
  ],
})
