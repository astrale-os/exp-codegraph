export declare const PACKAGE_NAME_PATTERN = "^(?:@[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?|[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)$";
export declare function isPackageName(value: string): boolean;
export declare function packageNameFromSpecifier(specifier: string): string;
