import { readFile } from 'node:fs/promises';
import { NATIVE_ANALYSIS_PROTOCOL_VERSION } from '../../protocol/index.js';
import { NativeAnalysisDistributionError } from './model.js';
export const NATIVE_RELEASE_FORMAT = 'astrale.codegraph.native-release';
export const NATIVE_ARTIFACT_FORMAT = 'astrale.codegraph.native-artifact';
export const NATIVE_ARTIFACT_PACKAGES = Object.freeze({
    'darwin-arm64': '@astrale-os/codegraph-native-darwin-arm64',
    'darwin-x64': '@astrale-os/codegraph-native-darwin-x64',
    'linux-arm64': '@astrale-os/codegraph-native-linux-arm64',
    'linux-x64': '@astrale-os/codegraph-native-linux-x64',
});
export async function readNativeReleaseManifest(path, packageVersion, target) {
    let input;
    try {
        input = JSON.parse(await readFile(path, 'utf8'));
    }
    catch (cause) {
        throw new NativeAnalysisDistributionError('NATIVE_RELEASE_MANIFEST_INVALID', 'Codegraph native release manifest is missing or invalid JSON.', target, { cause });
    }
    const value = record(input);
    if (value.format !== NATIVE_RELEASE_FORMAT ||
        value.version !== 1 ||
        value.packageVersion !== packageVersion ||
        value.protocolVersion !== NATIVE_ANALYSIS_PROTOCOL_VERSION ||
        typeof value.sourceRevision !== 'string' ||
        !/^[a-f0-9]{40}$/u.test(value.sourceRevision) ||
        !validToolchain(value.toolchain) ||
        !recordOrUndefined(value.artifacts)) {
        throw new NativeAnalysisDistributionError('NATIVE_RELEASE_MANIFEST_INVALID', 'Codegraph native release manifest does not match the installed package or protocol.', target);
    }
    const artifacts = value.artifacts;
    for (const [key, artifact] of Object.entries(artifacts)) {
        if (!isTarget(key) || !validArtifact(artifact, key, NATIVE_ARTIFACT_PACKAGES[key])) {
            throw new NativeAnalysisDistributionError('NATIVE_RELEASE_MANIFEST_INVALID', `Codegraph native release manifest contains an invalid ${key} artifact.`, target);
        }
    }
    return input;
}
export function admitNativeArtifactPackageManifest(input, expected, packageVersion) {
    const value = record(input);
    if (value.format !== NATIVE_ARTIFACT_FORMAT ||
        value.version !== 1 ||
        value.packageVersion !== packageVersion ||
        value.protocolVersion !== NATIVE_ANALYSIS_PROTOCOL_VERSION ||
        !validArtifact(value.artifact, expected.target, expected.package) ||
        !sameArtifact(value.artifact, expected)) {
        throw new NativeAnalysisDistributionError('NATIVE_ARTIFACT_INVALID', `Native artifact package manifest is invalid for ${expected.target}.`, expected.target);
    }
    return input;
}
function sameArtifact(input, expected) {
    const value = record(input);
    return value.target === expected.target &&
        value.package === expected.package &&
        value.executable === expected.executable &&
        value.bytes === expected.bytes &&
        value.sha256 === expected.sha256;
}
export function currentNativeAnalysisTarget() {
    return `${process.platform}-${process.arch}`;
}
function validArtifact(input, target, packageName) {
    const value = record(input);
    return value.target === target &&
        value.package === packageName &&
        typeof value.executable === 'string' &&
        portableArtifactPath(value.executable) &&
        Number.isSafeInteger(value.bytes) &&
        value.bytes > 0 &&
        typeof value.sha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.sha256);
}
function portableArtifactPath(value) {
    return Boolean(value) && !value.startsWith('/') && !value.includes('\\') &&
        value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}
function validToolchain(input) {
    const value = record(input);
    return ['ttsc', 'typescriptGo', 'go'].every((key) => typeof value[key] === 'string' && Boolean(value[key].trim()));
}
function recordOrUndefined(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function record(value) {
    return recordOrUndefined(value) ? value : {};
}
function isTarget(value) {
    return Object.hasOwn(NATIVE_ARTIFACT_PACKAGES, value);
}
//# sourceMappingURL=manifest.js.map