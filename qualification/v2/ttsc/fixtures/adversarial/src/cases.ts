import { defineMutation as mutation, type MutationOptions } from '@fixture/sdk'
import { referencedBuilder } from '@fixture/referenced'
import { defineMutation as spellingCollision } from './fake.ts'

declare const runtimeFlag: boolean
declare const runtimeName: string

const storedCallback = () => 'stored'

function callbackFactory(): () => string {
  return storedCallback
}

function forward(
  builder: typeof mutation,
  options: MutationOptions,
): MutationOptions {
  return builder(options)
}

export function aliasCase(): MutationOptions {
  return mutation({ name: 'known', run: storedCallback })
}

export function templateCase(): MutationOptions {
  return mutation({ name: `template-known` })
}

export function ambiguousCase(): MutationOptions {
  return mutation({ name: runtimeFlag ? 'left' : 'right' })
}

export function unknownCase(): MutationOptions {
  return mutation({ name: runtimeName })
}

export function unsupportedCase(): MutationOptions {
  return mutation({ name: String(Symbol('unsupported')) })
}

export function collisionCase(): { readonly name: string } {
  return spellingCollision({ name: 'fake' })
}

export function returnedCallbackCase(): MutationOptions {
  return mutation({ name: 'returned', run: callbackFactory() })
}

export function closureCase(): MutationOptions {
  const innerCallback = () => 'inner'
  return mutation({ name: 'closure', run: innerCallback })
}

export function forwardingCase(): MutationOptions {
  return forward(mutation, { name: 'forwarded', run: storedCallback })
}

export function duplicateCase(): readonly MutationOptions[] {
  return [mutation({ name: 'first' }), mutation({ name: 'second' })]
}

export function projectReferenceCase(): string {
  return referencedBuilder('project-reference')
}

export function controlFlowCase(input: number): number {
  let total = 0
  for (let index = 0; index < input; index += 1) {
    if (index % 2 === 0) continue
    total += index
    if (total > 10) break
  }
  if (input < 0) throw new Error('negative')
  return total
}
