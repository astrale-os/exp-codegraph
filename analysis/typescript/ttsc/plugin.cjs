const path = require('node:path')

module.exports = (context) => ({
  name: 'astrale-typespec-v2-native-analysis',
  source: path.resolve(context.dirname, '../native'),
  stage: 'check',
  reportsTypeScriptDiagnostics: true,
})
