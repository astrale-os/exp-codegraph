# Command-line ownership

The CLI owns argument normalization, operating-system process behavior, terminal output, exit status,
and restart checkpoints. The application remains the canonical producer of a check result; the CLI
may replay that result only after exact executable, request, repository, and inventory admission.

Checkpoint absence, corruption, version drift, or identity uncertainty is an advisory miss. It must
run the canonical application command and must never manufacture success, suppress a diagnostic, or
change the byte-ordered stdout/stderr transcript.
