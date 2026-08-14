import { defineMutation as defineSdkMutation } from '@fixture/builder'
import { referencedBuilder } from '@fixture/referenced'

import { defineMutation as defineFakeMutation } from './fake.js'
import { callbackFactory, forward } from './helpers.js'

const knownName = 'known'
const unknownName = process.env.MUTATION_NAME ?? 'runtime'

export const direct = defineSdkMutation({
  name: knownName,
  callback: (input) => input.toUpperCase(),
})

export const forwarded = forward(defineSdkMutation, {
  name: `forwarded-${knownName}`,
  callback: callbackFactory('prefix'),
})

export const unknowable = defineSdkMutation({
  name: unknownName,
  callback: (input) => input,
})

export const collision = defineFakeMutation({ name: knownName })
export const referenced = referencedBuilder(knownName)
