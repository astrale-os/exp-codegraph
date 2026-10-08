import missing from './missing.js'
export { absent } from './absent.js'
export const missingLazy = import('./missing-lazy.js')
declare const variablePath: string
export const unknownLazy = import(variablePath)
export const unknown = missing
