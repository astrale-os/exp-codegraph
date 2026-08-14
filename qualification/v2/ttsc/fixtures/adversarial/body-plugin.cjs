const path = require('node:path')

module.exports = (context) => ({
  name: 'astrale-typespec-v2-body-qualification',
  source: path.resolve(context.dirname, 'body-plugin'),
  stage: 'check',
})
