# Repository evidence

Repository inventory describes files whether or not TypeScript includes them. Purpose, provenance,
lifecycle, and delivery are independent classifications backed by evidence. Filters choose a view;
they never erase retained evidence or change a project universe.

A Git-backed source proof may admit an exact source state before inventory. The proof is an opaque
portable key; Git execution and dirty working-tree evidence remain Node adapter concerns, and every
uncertainty falls back to complete inventory.

```mermaid
flowchart LR
  F[filesystem + Git evidence] --> I[complete inventory]
  I --> C[purpose]
  I --> P[provenance]
  I --> L[lifecycle]
  I --> D[delivery]
  C --> Q[filtered query]
  P --> Q
  L --> Q
  D --> Q
  I --> A[aggregate facts]
```

Tests, fixtures, specifications, generated output, evidence, assets, and unknown files remain first-
class inventory records. TypeScript project membership is joined later through portable source
identity; it is not inferred from a repository-purpose filter.
