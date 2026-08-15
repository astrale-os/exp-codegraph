export const MODULE_CONTRACT_ID = 'contract.module.v2';
export function declarationKey(source, pointer) {
    return `${source}#${pointer}`;
}
export function expectedLocation(module, pointer) {
    return module.locations[pointer] ?? { file: module.source, line: 1, column: 1, pointer };
}
//# sourceMappingURL=model.js.map