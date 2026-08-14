# Node application composition

This adapter owns Node filesystem persistence and native-plugin cache lifecycle around the portable
TypeSpec application. Physical checkout identities are confined to SQLite namespaces and never enter
semantic repository, generation, fact, or application identities.
