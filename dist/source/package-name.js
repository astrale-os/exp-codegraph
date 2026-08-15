export const PACKAGE_NAME_PATTERN = '^(?:@[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?|[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)$';
const PACKAGE_NAME = new RegExp(PACKAGE_NAME_PATTERN);
export function isPackageName(value) {
    return PACKAGE_NAME.test(value);
}
export function packageNameFromSpecifier(specifier) {
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
//# sourceMappingURL=package-name.js.map