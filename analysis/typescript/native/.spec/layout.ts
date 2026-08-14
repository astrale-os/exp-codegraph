import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: [
    'body.go',
    'cfg.go',
    'dependency.go',
    'extract.go',
    'framing.go',
    'framing_test.go',
    'go.mod',
    'identity.go',
    'main.go',
    'model.go',
    'module.go',
    'session.go',
    'surface_declaration.go',
    'surface_export.go',
    'surface_identity.go',
    'surface_type.go',
  ],
  exact: true,
})
