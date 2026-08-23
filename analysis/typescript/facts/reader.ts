import type { Fact } from '../../facts/index.ts'
import type { AnalysisQuery } from '../../query/index.ts'
import {
  TYPESCRIPT_FACT_NAMESPACES,
  TypeScriptFactContractError,
  type NormalizedTypeScriptModuleFact,
  type TypeScriptFact,
  type TypeScriptFactKind,
  type AnyTypeScriptFact,
  type TypeScriptFactReader,
} from './model.ts'
import { validateTypeScriptFactPayload } from './validate.ts'

export function createTypeScriptFactReader(query: AnalysisQuery): TypeScriptFactReader {
  let declarationIndex: Promise<ReadonlyMap<string, TypeScriptFact<'declaration'>>> | undefined
  const allDeclarations = () =>
    (declarationIndex ??= loadDeclarationIndex(query))
  return {
    async facts(kind, filter = {}, page) {
      const result = await query.facts(
        factFilter(kind, filter),
        page,
      )
      return {
        ...result,
        facts: await admitFacts(query, kind, result.facts),
      }
    },
    async factsById(kind, ids) {
      return admitFacts(query, kind, await query.factsById(ids))
    },
    async *export(kind, filter = {}) {
      const declarations = kind === 'module' ? await allDeclarations() : undefined
      for await (const fact of query.export({
        ...factFilter(kind, filter),
      })) {
        yield (kind === 'module'
          ? hydrateModule(fact, declarations!)
          : admit(kind, fact)) as TypeScriptFact<typeof kind>
      }
    },
    async *exportAll(filter = {}) {
      const declarations = await allDeclarations()
      for await (const fact of query.export({
        ...filter,
        namespaces: [...new Set(Object.values(TYPESCRIPT_FACT_NAMESPACES))],
      })) {
        if (
          fact.namespace === TYPESCRIPT_FACT_NAMESPACES.declaration &&
          fact.kind === 'declaration'
        ) {
          admit('declaration', fact)
          continue
        }
        yield fact.namespace === TYPESCRIPT_FACT_NAMESPACES.module && fact.kind === 'module'
          ? hydrateModule(fact, declarations)
          : admitAny(fact)
      }
    },
  }
}

const kindByNamespace = new Map<string, TypeScriptFactKind>(
  Object.entries(TYPESCRIPT_FACT_NAMESPACES)
    .filter(([kind]) => kind !== 'declaration')
    .map(([kind, namespace]) => [namespace, kind as TypeScriptFactKind]),
)

function admitAny(fact: Fact): AnyTypeScriptFact {
  const kind =
    fact.namespace === TYPESCRIPT_FACT_NAMESPACES.declaration && fact.kind === 'declaration'
      ? 'declaration'
      : kindByNamespace.get(fact.namespace)
  if (!kind) {
    throw new TypeScriptFactContractError('project', fact.id, [
      `namespace:${fact.namespace}`,
    ])
  }
  return admit(kind, fact) as AnyTypeScriptFact
}

function admit<Kind extends TypeScriptFactKind>(
  kind: Kind,
  fact: Fact,
): TypeScriptFact<Kind> {
  const diagnostics: string[] = []
  if (fact.namespace !== TYPESCRIPT_FACT_NAMESPACES[kind]) {
    diagnostics.push(`namespace:${fact.namespace}`)
  }
  if (kind === 'module' && fact.kind !== 'module') diagnostics.push(`kind:${fact.kind}`)
  if (kind === 'declaration' && fact.kind !== 'declaration') diagnostics.push(`kind:${fact.kind}`)
  if (fact.schemaVersion !== 1 && !(kind === 'module' && fact.schemaVersion === 2)) {
    diagnostics.push(`schema-version:${fact.schemaVersion}`)
  }
  diagnostics.push(...validateTypeScriptFactPayload(kind, fact.payload, fact.schemaVersion))
  if (diagnostics.length) throw new TypeScriptFactContractError(kind, fact.id, diagnostics)
  return fact as TypeScriptFact<Kind>
}

async function admitFacts<Kind extends TypeScriptFactKind>(
  query: AnalysisQuery,
  kind: Kind,
  facts: readonly Fact[],
): Promise<readonly TypeScriptFact<Kind>[]> {
  if (kind !== 'module') return facts.map((fact) => admit(kind, fact))
  const raw = facts.map((fact) => admit(kind, fact))
  const references = raw.flatMap((fact) =>
    fact.schemaVersion === 2
      ? (fact.payload as unknown as NormalizedTypeScriptModuleFact).declarations.map(
          (declaration) => declaration.fact,
        )
      : [],
  )
  const declarations = new Map<string, TypeScriptFact<'declaration'>>()
  for (const fact of await query.factsById([...new Set(references)].sort())) {
    const admitted = admit('declaration', fact)
    if (declarations.has(admitted.id)) {
      throw new TypeScriptFactContractError('declaration', admitted.id, ['fact:duplicate'])
    }
    declarations.set(admitted.id, admitted)
  }
  return raw.map((fact) => hydrateModule(fact, declarations)) as unknown as readonly TypeScriptFact<Kind>[]
}

async function loadDeclarationIndex(
  query: AnalysisQuery,
): Promise<ReadonlyMap<string, TypeScriptFact<'declaration'>>> {
  const declarations = new Map<string, TypeScriptFact<'declaration'>>()
  for await (const fact of query.export({
    namespaces: [TYPESCRIPT_FACT_NAMESPACES.declaration],
    kinds: ['declaration'],
  })) {
    if (
      fact.namespace !== TYPESCRIPT_FACT_NAMESPACES.declaration ||
      fact.kind !== 'declaration'
    ) {
      continue
    }
    const admitted = admit('declaration', fact)
    if (declarations.has(admitted.id)) {
      throw new TypeScriptFactContractError('declaration', admitted.id, ['fact:duplicate'])
    }
    declarations.set(admitted.id, admitted)
  }
  return declarations
}

function factFilter(
  kind: TypeScriptFactKind,
  filter: Omit<import('../../query/index.ts').FactFilter, 'namespaces'>,
): import('../../query/index.ts').FactFilter {
  return {
    ...filter,
    namespaces: [TYPESCRIPT_FACT_NAMESPACES[kind]],
    ...(kind === 'module' || kind === 'declaration' ? { kinds: [kind] } : {}),
  }
}

function hydrateModule(
  input: Fact,
  declarations: ReadonlyMap<string, TypeScriptFact<'declaration'>>,
): TypeScriptFact<'module'> {
  const fact = admit('module', input)
  if (fact.schemaVersion === 1) return fact
  const normalized = fact.payload as unknown as NormalizedTypeScriptModuleFact
  const payload = {
    ...normalized,
    declarations: normalized.declarations.map((reference) => {
      const declaration = declarations.get(reference.fact)
      if (
        !declaration ||
        declaration.subject !== reference.identity ||
        declaration.payload.declaration.identity !== reference.identity
      ) {
        throw new TypeScriptFactContractError('module', fact.id, [
          `declaration:${reference.fact}:missing-or-mismatched`,
        ])
      }
      return { ...declaration.payload.declaration, exportPaths: reference.exportPaths }
    }),
  }
  const diagnostics = validateTypeScriptFactPayload('module', payload, 1)
  if (diagnostics.length) throw new TypeScriptFactContractError('module', fact.id, diagnostics)
  return { ...fact, schemaVersion: 1, payload }
}
