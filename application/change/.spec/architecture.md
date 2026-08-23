# Application change impact

This headless index maps canonical repository paths to specification owners and their reverse
declaration/source-reference closure. A file contained by a module root affects that owner; an
owned declaration additionally affects every transitive consumer. Unknown declaration and
configuration changes select the complete corpus rather than guessing.

Change hints are never semantic authority. The caller validates them against the exact repository
inventory and may force `conservative-full` whenever create, delete, rename, or topology evidence
is incomplete.

The corpus refresh operation applies that admitted impact to immutable specification snapshots. It
recompiles only normative owners, retains exact unaffected snapshots, and widens to the conservative
owner closure when declaration or topology evidence is incomplete.
