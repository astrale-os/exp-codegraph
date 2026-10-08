import { api } from './api.js'
import { cycleA } from './cycle-a.js'
export function cycleB(): string { return api('cycle') }
export const cycle = cycleA
