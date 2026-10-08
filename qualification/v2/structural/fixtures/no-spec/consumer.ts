// Unicode before reference evidence: 🧭 café
import { renamed as invoke } from './public.js'
import * as namespace from './api.js'
import type { Options } from './barrel.js'
const options: Options = { value: 'typed' }
export const direct = invoke(options.value)
export const qualified = namespace.api('namespace')
export const shorthand = { invoke }
export const lazy = import('./public.js')
