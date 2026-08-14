import type { RepositoryInventory } from '../../../repository/.spec/api.js'
import type { SpecificationSnapshot } from '../../../specification/.spec/api.js'
import type { TypeSpecApplicationSnapshot } from '../../.spec/api.js'

export function createApplicationSnapshot(
  input: Omit<TypeSpecApplicationSnapshot, 'format' | 'version' | 'id'>,
): TypeSpecApplicationSnapshot

export function assertSpecificationInventory(
  specifications: readonly SpecificationSnapshot[],
  inventory: RepositoryInventory,
): void
