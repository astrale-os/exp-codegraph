import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const installation = value('--installation')
const root = value('--root')
const database = value('--database')
const incremental = process.argv.includes('--incremental')

if (!installation || !root || !database) {
  throw new Error('build-worker.mjs requires --installation, --root, and --database.')
}

const packageJson = JSON.parse(
  await (await import('node:fs/promises')).readFile(resolve(installation, 'package.json'), 'utf8'),
)
const codegraph = await import(
  pathToFileURL(resolve(installation, packageJson.main ?? 'dist/index.js')).href
)
const started = performance.now()
const result = await codegraph.buildGraph(root, {
  dbPath: database,
  incremental,
  skipRegistry: true,
  userConfig: false,
  dataflow: true,
  ast: true,
  cfg: true,
  complexity: true,
})
const elapsedMs = Math.round(performance.now() - started)
const databaseBytes = (await stat(database)).size
const query = queryBenchmark(database)
process.stdout.write(
  `\nASTRALE_CODEGRAPH_BUILD=${JSON.stringify({
    elapsedMs,
    maximumRssBytes: process.resourceUsage().maxRSS * 1024,
    databaseBytes,
    changed: result !== undefined,
    phases: result?.phases,
    query,
  })}\n`,
)

function queryBenchmark(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const seed = db
      .prepare(
        `SELECT id, name, qualified_name, file FROM nodes
         WHERE kind IN ('function', 'method', 'class', 'interface', 'type')
         ORDER BY exported DESC, file, line LIMIT 1`,
      )
      .get()
    const node = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 50')
    const outgoing = db.prepare(
      `SELECT edge.kind, target.name, target.kind, target.file
       FROM edges AS edge JOIN nodes AS target ON target.id = edge.target_id
       WHERE edge.source_id = ? ORDER BY edge.kind, target.file, target.name LIMIT 100`,
    )
    const ast = db.prepare(
      `SELECT file, line, kind, name, receiver FROM ast_nodes
       WHERE kind = 'call' ORDER BY file, line LIMIT 100`,
    )
    return {
      nodeByName: samples(() => node.all(seed?.name ?? '')),
      outgoingEdges: samples(() => outgoing.all(seed?.id ?? -1)),
      astCalls: samples(() => ast.all()),
    }
  } finally {
    db.close()
  }
}

function samples(run) {
  const values = []
  for (let index = 0; index < 100; index++) {
    const started = performance.now()
    run()
    values.push(performance.now() - started)
  }
  values.sort((left, right) => left - right)
  return {
    samples: values.length,
    medianMs: round(values[Math.floor(values.length / 2)]),
    p95Ms: round(values[Math.floor(values.length * 0.95)]),
  }
}

function value(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function round(input) {
  return Math.round(input * 1000) / 1000
}
