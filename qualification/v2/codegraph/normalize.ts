import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export interface NormalizedCodegraph {
  readonly digest: string
  readonly tables: Readonly<Record<string, readonly unknown[]>>
}

/** Normalize semantic rows without depending on process-local SQLite integer identities. */
export function normalizeCodegraph(file: string): NormalizedCodegraph {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    const tables = {
      nodes: rows(
        database,
        `SELECT n.name, n.kind, n.file, n.line, n.end_line,
                COALESCE(n.qualified_name, n.name) AS qualified_name, n.scope,
                n.visibility, n.exported, n.role, n.content_hash, n.accessor_kind, n.entrypoint,
                p.file AS parent_file, COALESCE(p.qualified_name, p.name) AS parent_name,
                p.kind AS parent_kind
         FROM nodes AS n
         LEFT JOIN nodes AS p ON p.id = n.parent_id
         ORDER BY n.file, n.line, n.kind, n.name, n.qualified_name`,
      ),
      edges: rows(
        database,
        `SELECT source.file AS source_file,
                COALESCE(source.qualified_name, source.name) AS source_name,
                source.kind AS source_kind, source.line AS source_line,
                target.file AS target_file,
                COALESCE(target.qualified_name, target.name) AS target_name,
                target.kind AS target_kind, target.line AS target_line,
                edge.kind, edge.confidence, edge.dynamic, edge.technique, edge.dynamic_kind
         FROM edges AS edge
         JOIN nodes AS source ON source.id = edge.source_id
         JOIN nodes AS target ON target.id = edge.target_id
         ORDER BY source_file, source_line, source_kind, source_name,
                  target_file, target_line, target_kind, target_name, edge.kind`,
      ),
      metrics: rows(
        database,
        `SELECT node.file, COALESCE(node.qualified_name, node.name) AS qualified_name,
                node.kind, node.line,
                metric.line_count, metric.symbol_count, metric.import_count,
                metric.export_count, metric.fan_in, metric.fan_out, metric.cohesion,
                metric.file_count
         FROM node_metrics AS metric
         JOIN nodes AS node ON node.id = metric.node_id
         ORDER BY node.file, node.line, node.kind, node.qualified_name`,
      ),
      complexity: rows(
        database,
        `SELECT node.file, COALESCE(node.qualified_name, node.name) AS qualified_name,
                node.kind, node.line,
                metric.cognitive, metric.cyclomatic, metric.max_nesting,
                metric.loc, metric.sloc, metric.comment_lines,
                metric.halstead_volume, metric.halstead_difficulty,
                metric.halstead_effort, metric.halstead_bugs, metric.maintainability_index
         FROM function_complexity AS metric
         JOIN nodes AS node ON node.id = metric.node_id
         ORDER BY node.file, node.line, node.kind, node.qualified_name`,
      ),
      ast: rows(
        database,
        `SELECT ast.file, ast.line, ast.kind, ast.name, ast.text, ast.receiver,
                parent.file AS parent_file,
                COALESCE(parent.qualified_name, parent.name) AS parent_name,
                parent.kind AS parent_kind, parent.line AS parent_line
         FROM ast_nodes AS ast
         LEFT JOIN nodes AS parent ON parent.id = ast.parent_node_id
         ORDER BY ast.file, ast.line, ast.kind, ast.name, ast.text`,
      ),
      cfgBlocks: rows(
        database,
        `SELECT fn.file, COALESCE(fn.qualified_name, fn.name) AS qualified_name,
                fn.kind, fn.line,
                block.block_index, block.block_type, block.start_line, block.end_line, block.label
         FROM cfg_blocks AS block
         JOIN nodes AS fn ON fn.id = block.function_node_id
         ORDER BY fn.file, fn.line, fn.kind, fn.qualified_name, block.block_index`,
      ),
      cfgEdges: rows(
        database,
        `SELECT fn.file, COALESCE(fn.qualified_name, fn.name) AS qualified_name,
                fn.kind, fn.line,
                source.block_index AS source_block, target.block_index AS target_block, edge.kind
         FROM cfg_edges AS edge
         JOIN nodes AS fn ON fn.id = edge.function_node_id
         JOIN cfg_blocks AS source ON source.id = edge.source_block_id
         JOIN cfg_blocks AS target ON target.id = edge.target_block_id
         ORDER BY fn.file, fn.line, fn.kind, fn.qualified_name,
                  source.block_index, target.block_index, edge.kind`,
      ),
      dataflowVertices: rows(
        database,
        `SELECT fn.file, COALESCE(fn.qualified_name, fn.name) AS qualified_name,
                fn.kind AS function_kind, fn.line AS function_line,
                vertex.kind, vertex.name, vertex.param_index, vertex.line,
                node.file AS node_file,
                COALESCE(node.qualified_name, node.name) AS node_name,
                node.kind AS node_kind, node.line AS node_line
         FROM dataflow_vertices AS vertex
         JOIN nodes AS fn ON fn.id = vertex.func_id
         LEFT JOIN nodes AS node ON node.id = vertex.node_id
         ORDER BY fn.file, function_line, function_kind, fn.qualified_name,
                  vertex.kind, vertex.param_index, vertex.line, vertex.name`,
      ),
      dataflow: rows(
        database,
        `SELECT source.file AS source_file,
                COALESCE(source.qualified_name, source.name) AS source_name,
                source.kind AS source_kind, source.line AS source_line,
                target.file AS target_file,
                COALESCE(target.qualified_name, target.name) AS target_name,
                target.kind AS target_kind, target.line AS target_line,
                source_vertex.kind AS source_vertex_kind,
                source_vertex.name AS source_vertex_name,
                source_vertex.param_index AS source_vertex_parameter,
                target_vertex.kind AS target_vertex_kind,
                target_vertex.name AS target_vertex_name,
                target_vertex.param_index AS target_vertex_parameter,
                flow.kind, flow.param_index, flow.expression, flow.line,
                flow.confidence, flow.scope
         FROM dataflow AS flow
         LEFT JOIN nodes AS source ON source.id = flow.source_id
         LEFT JOIN nodes AS target ON target.id = flow.target_id
         LEFT JOIN dataflow_vertices AS source_vertex ON source_vertex.id = flow.source_vertex
         LEFT JOIN dataflow_vertices AS target_vertex ON target_vertex.id = flow.target_vertex
         ORDER BY source_file, source_line, source_kind, source_name,
                  target_file, target_line, target_kind, target_name,
                  flow.kind, flow.line, flow.param_index`,
      ),
      files: rows(database, `SELECT file, hash, size FROM file_hashes ORDER BY file`),
    } satisfies Record<string, readonly unknown[]>
    const serialized = JSON.stringify(tables)
    return {
      digest: createHash('sha256').update(serialized).digest('hex'),
      tables,
    }
  } finally {
    database.close()
  }
}

export function tableCounts(value: NormalizedCodegraph): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(value.tables).map(([name, entries]) => [name, entries.length]),
  )
}

function rows(database: DatabaseSync, sql: string): readonly unknown[] {
  try {
    return database.prepare(sql).all()
  } catch (error) {
    if (error instanceof Error && /no such (table|column)/u.test(error.message)) return []
    throw error
  }
}
