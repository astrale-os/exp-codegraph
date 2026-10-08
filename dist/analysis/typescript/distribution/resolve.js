import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { admitNativeOxlintArtifact, currentNativeAnalysisTarget, NATIVE_ARTIFACT_DIRECTORY, readNativeReleaseManifest, } from './manifest.js';
import { NativeAnalysisDistributionError } from './model.js';
/** Resolve and validate one explicit or package-delivered native analyzer without building it. */
export async function resolvePackagedNativeAnalysis(options = {}) {
    const root = packageRoot();
    const packageVersion = await installedPackageVersion(resolve(root, 'package.json'));
    const target = currentNativeAnalysisTarget();
    if (options.binary) {
        const command = resolve(options.binary);
        const admitted = await admitExecutable(command, target);
        return { ...admitted, command, target, packageVersion, origin: 'explicit' };
    }
    const authority = await resolveArtifact(root, packageVersion, target);
    const native = await admitPackagedExecutable(authority.artifactRoot, authority.artifact, target);
    return { ...native, target, packageVersion, origin: 'package' };
}
/** Resolve the generic worker independently so the original analyzer can recover without it. */
export async function resolvePackagedNativeOxlint() {
    const root = packageRoot();
    const packageVersion = await installedPackageVersion(resolve(root, 'package.json'));
    const target = currentNativeAnalysisTarget();
    const authority = await resolveArtifact(root, packageVersion, target);
    const worker = admitNativeOxlintArtifact(authority.artifact);
    const admitted = await admitPackagedExecutable(authority.artifactRoot, worker, target);
    return { ...worker, ...admitted, target, packageVersion, origin: 'package' };
}
async function resolveArtifact(root, packageVersion, target) {
    const release = await readNativeReleaseManifest(resolve(root, 'native-release.json'), packageVersion, target);
    const artifact = release.artifacts[target];
    if (!artifact) {
        throw new NativeAnalysisDistributionError('NATIVE_TARGET_UNSUPPORTED', `Codegraph ${packageVersion} has no native analyzer for ${target}.`, target);
    }
    const artifactRoot = resolve(await realpath(root), NATIVE_ARTIFACT_DIRECTORY, artifact.target);
    return { artifactRoot, artifact };
}
async function admitPackagedExecutable(artifactRoot, artifact, target) {
    let command;
    try {
        command = await realpath(resolve(artifactRoot, artifact.executable));
    }
    catch (cause) {
        throw new NativeAnalysisDistributionError('NATIVE_ARTIFACT_INVALID', `Packaged ${target} executable ${artifact.executable} is missing or unreadable.`, target, { cause });
    }
    if (!within(artifactRoot, command)) {
        throw new NativeAnalysisDistributionError('NATIVE_ARTIFACT_INVALID', `Packaged ${target} executable ${artifact.executable} resolves outside its artifact directory.`, target);
    }
    const admitted = await admitExecutable(command, target);
    if (admitted.bytes !== artifact.bytes || admitted.sha256 !== artifact.sha256) {
        throw new NativeAnalysisDistributionError('NATIVE_ARTIFACT_DIGEST_MISMATCH', `Packaged ${target} executable ${artifact.executable} does not match the qualified release manifest.`, target);
    }
    return { ...admitted, command };
}
async function admitExecutable(path, target) {
    let metadata;
    try {
        metadata = await stat(path);
    }
    catch (cause) {
        throw new NativeAnalysisDistributionError('NATIVE_ARTIFACT_INVALID', `Native analyzer is not a readable regular file: ${path}`, target, { cause });
    }
    if (!metadata.isFile()) {
        throw new NativeAnalysisDistributionError('NATIVE_ARTIFACT_INVALID', `Native analyzer is not a regular file: ${path}`, target);
    }
    if (process.platform !== 'win32' && (metadata.mode & 0o111) === 0) {
        throw new NativeAnalysisDistributionError('NATIVE_ARTIFACT_NOT_EXECUTABLE', `Native analyzer is not executable: ${path}`, target);
    }
    const bytes = await readFile(path);
    return {
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
    };
}
async function installedPackageVersion(path) {
    try {
        const value = JSON.parse(await readFile(path, 'utf8'));
        if (typeof value.version === 'string' && value.version.trim())
            return value.version;
    }
    catch (cause) {
        throw new NativeAnalysisDistributionError('NATIVE_RELEASE_MANIFEST_INVALID', `Cannot read package version from ${path}.`, currentNativeAnalysisTarget(), { cause });
    }
    throw new NativeAnalysisDistributionError('NATIVE_RELEASE_MANIFEST_INVALID', `Package version is missing from ${path}.`, currentNativeAnalysisTarget());
}
function packageRoot() {
    const candidate = resolve(import.meta.dirname, '../../..');
    return basename(candidate) === 'dist' ? dirname(candidate) : candidate;
}
function within(root, target) {
    const path = relative(root, target);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
