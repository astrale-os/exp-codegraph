/** Build the bounded Node invocation and retain a stable operator-visible worker role. */
export function codegraphWorkerProcess(role, worker, maxOldSpaceMegabytes, trailingArguments = []) {
    return {
        executable: process.execPath,
        arguments: [
            `--max-old-space-size=${maxOldSpaceMegabytes}`,
            worker,
            `--codegraph-worker=${role}`,
            ...trailingArguments,
        ],
    };
}
//# sourceMappingURL=worker-process.js.map