import type { ReferencedType } from '@fixture/referenced'

import { referencedBuilder as referencedBuilderA } from '@fixture/referenced'
import { referencedBuilder as referencedBuilderB } from '@fixture/referenced'

export interface MutationOptions {
  readonly name: string
  readonly run?: () => unknown
  readonly marker?: null
}

declare const SURFACE_BRAND: unique symbol

export type AuthenticationMode = 'optional' | 'required'
export type BrandedText = string & { readonly [SURFACE_BRAND]: true }
export type GenericBrand<Kind extends string> = Readonly<Record<`__${Lowercase<Kind>}Id`, true>>
export type GenericConditional<Value extends string> = Value extends 'first'
  ? { readonly value: Value }
  : never
export interface GenericLookup<Values extends Readonly<Record<string, unknown>>> {
  get<Key extends keyof Values>(key: Key): Values[Key]
}
export type SurfaceChoice = BrandedText & ({ readonly kind: 'first' } | { readonly kind: 'second' })
export type LargeCounter = 9007199254740993n
type GenericValue<Descriptor extends MutationOptions> = Awaited<Descriptor['name']>
export type GenericOutcome<Descriptor extends MutationOptions> =
  | { readonly kind: 'value'; readonly value: GenericValue<Descriptor> }
  | { readonly kind: 'rejected'; readonly reason: string }
export type GenericHandler<Descriptor extends MutationOptions> = () =>
  | GenericOutcome<Descriptor>
  | PromiseLike<GenericOutcome<Descriptor>>

type FixtureLazy<Value> = Value | (() => Value)
export type InstantiatedLazy = FixtureLazy<string>

export interface SurfaceOptions {
  readonly auth?: AuthenticationMode
  readonly opaque: object
  readonly count: bigint
  readonly token: symbol
  readonly createdAt: Date
  readonly forbidden?: never
  readonly referenced: ReferencedType
}

export interface TupleHolder {
  readonly value: readonly [name: string, count: number]
}

export type StringMap = { readonly [key: string]: number }

export interface MergedSurface {
  readonly value: string
}

export namespace MergedSurface {
  export type Kind = 'merged'
}

export class PublicBox {
  readonly value: string
  #secret: string

  constructor(value: string) {
    this.value = value
    this.#secret = value
  }

  chain(): this {
    return this
  }
}

export type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json }
export type MutationPayload = Readonly<Record<string, Json>>

export type RecursiveArray = readonly RecursiveValue[]
export type RecursiveObject = { readonly [name: string]: RecursiveValue }
export type RecursiveValue = null | string | RecursiveArray | RecursiveObject
export type BroadString = string | '*'

export const frozenSurface = Object.freeze({
  match: /fixture/u,
  name: 'fixture',
})

export function defineMutation<const Options extends MutationOptions>(options: Options): Options {
  return options
}

export declare function conditionalKind<Kind extends 'first' | 'second'>(
  kind: Kind,
): Kind extends 'first' ? 1 : 2

export const brandedResult = () => ({}) as GenericBrand<'Fixture'>
export declare function indexedResult(): SurfaceOptions['auth']
export declare function optionalMode(mode?: AuthenticationMode): void

export function identityPayload(payload: MutationPayload): MutationPayload {
  return payload
}

// Two syntax occurrences deliberately project to one logical module edge.
void referencedBuilderA
void referencedBuilderB
