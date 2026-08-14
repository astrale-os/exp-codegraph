import { describe, expect, it } from 'vitest'

import { graphRouteHref, readRoute, routeHref } from '../viewer/shell/route.ts'

describe('viewer routes', () => {
  it('routes the system map independently from module selection', () => {
    expect(graphRouteHref()).toBe('?view=graph')
    expect(readRoute({ search: graphRouteHref() })).toEqual({
      source: undefined,
      pointer: undefined,
      tab: undefined,
      view: 'graph',
    })
    expect(readRoute({ search: '?view=unknown' }).view).toBeUndefined()
  })

  it('keeps document selection in the query and leaves fragments to renderers', () => {
    expect(routeHref('alpha/.spec/api.d.ts')).toBe('?spec=alpha%2F.spec%2Fapi.d.ts')
    expect(routeHref('alpha/.spec/api.d.ts', '/a b')).toBe(
      '?spec=alpha%2F.spec%2Fapi.d.ts&at=%2Fa+b',
    )
    expect(routeHref('alpha/.spec/api.d.ts', undefined, 'data')).toBe(
      '?spec=alpha%2F.spec%2Fapi.d.ts&tab=data',
    )
    expect(routeHref('alpha/.spec/api.d.ts', '/a b', 'logic')).toBe(
      '?spec=alpha%2F.spec%2Fapi.d.ts&at=%2Fa+b&tab=logic',
    )
  })

  it('distinguishes no pointer from the valid root pointer', () => {
    expect(readRoute({ search: '?spec=alpha%2F.spec%2Fapi.d.ts' })).toEqual({
      source: 'alpha/.spec/api.d.ts',
      pointer: undefined,
      tab: undefined,
    })
    expect(readRoute({ search: '?spec=alpha%2F.spec%2Fapi.d.ts&at=' })).toEqual({
      source: 'alpha/.spec/api.d.ts',
      pointer: '',
      tab: undefined,
    })
    expect(readRoute({ search: '?spec=alpha%2F.spec%2Fapi.d.ts&tab=context' })).toEqual({
      source: 'alpha/.spec/api.d.ts',
      pointer: undefined,
      tab: 'context',
    })
    expect(readRoute({ search: '?spec=alpha%2F.spec%2Fapi.d.ts&tab=code' }).tab).toBe('code')
    expect(readRoute({ search: '?spec=alpha%2F.spec%2Fapi.d.ts&tab=unknown' }).tab).toBeUndefined()
  })

  it('round-trips API explorer locations for browser history and reloads', () => {
    const api = {
      source: 'alpha/graph/api.d.ts',
      declaration: 'graph.query.QueryAST',
      expanded: ['graph.query', 'graph'],
    }
    const href = routeHref('alpha/.spec/api.d.ts', undefined, 'api', api)

    expect(href).toBe(
      '?spec=alpha%2F.spec%2Fapi.d.ts&tab=api&apiFile=alpha%2Fgraph%2Fapi.d.ts&apiDecl=graph.query.QueryAST&apiOpen=graph&apiOpen=graph.query',
    )
    expect(readRoute({ search: href })).toEqual({
      source: 'alpha/.spec/api.d.ts',
      pointer: undefined,
      tab: 'api',
      api: {
        source: 'alpha/graph/api.d.ts',
        declaration: 'graph.query.QueryAST',
        expanded: ['graph', 'graph.query'],
      },
    })
  })

  it('round-trips a selected module resource', () => {
    const href = routeHref(
      'runtime/functions/.spec/api.d.ts',
      undefined,
      'flows',
      undefined,
      'runtime/functions/.spec/flows/dispatch.ts',
    )

    expect(readRoute({ search: href })).toMatchObject({
      source: 'runtime/functions/.spec/api.d.ts',
      tab: 'flows',
      resource: 'runtime/functions/.spec/flows/dispatch.ts',
    })
  })
})
