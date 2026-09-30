import { compileDeclarationApi, compileDeclarationApis } from '../api/project.js';
export async function compileApi(options) {
    return compileDeclarationApi(options);
}
export async function compileApis(options) {
    return compileDeclarationApis(options);
}
