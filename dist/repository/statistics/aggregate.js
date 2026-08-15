import { emptySourceLines } from './lines.js';
export function summarizeRepositoryStatistics(files) {
    const codeCounts = files.map((file) => file.lines.code).sort((left, right) => left - right);
    const largest = [...files].sort((left, right) => right.lines.code - left.lines.code ||
        right.bytes - left.bytes ||
        left.path.localeCompare(right.path))[0];
    const lines = sumSourceLines(files.map((file) => file.lines));
    return {
        files: files.length,
        bytes: files.reduce((total, file) => total + file.bytes, 0),
        lines,
        averageCodeLines: round(files.length ? lines.code / files.length : 0),
        medianCodeLines: percentile(codeCounts, 0.5),
        p95CodeLines: percentile(codeCounts, 0.95),
        ...(largest
            ? { largestFile: { path: largest.path, bytes: largest.bytes, codeLines: largest.lines.code } }
            : {}),
    };
}
export function aggregateRepositoryStatistics(files, inventoryFiles, groupings) {
    const statisticsBySource = new Map(files.map((file) => [file.source, file]));
    const groups = new Map();
    for (const inventoryFile of inventoryFiles) {
        const statistics = statisticsBySource.get(inventoryFile.source);
        if (!statistics)
            continue;
        for (const grouping of groupings) {
            const values = uniqueValues(grouping.values(inventoryFile));
            for (const value of values) {
                const identity = `${grouping.id}\u0000${value.key}`;
                const group = groups.get(identity) ?? {
                    dimension: grouping.id,
                    key: value.key,
                    label: value.label ?? value.key,
                    files: [],
                };
                group.files.push(statistics);
                groups.set(identity, group);
            }
        }
    }
    return [...groups.values()]
        .sort((left, right) => left.dimension.localeCompare(right.dimension) || left.key.localeCompare(right.key))
        .map(({ dimension, key, label, files: members }) => ({
        dimension,
        key,
        label,
        summary: summarizeRepositoryStatistics(members),
    }));
}
export function defaultRepositoryStatisticsGroupings() {
    return [
        scalarGrouping('language', (file) => file.language),
        scalarGrouping('package', (file) => file.package ?? 'unassigned'),
        scalarGrouping('area', (file) => file.area ?? 'unassigned'),
        scalarGrouping('purpose', (file) => file.classification.purpose),
        scalarGrouping('provenance', (file) => file.classification.provenance),
        scalarGrouping('lifecycle', (file) => file.classification.lifecycle),
        scalarGrouping('delivery', (file) => file.classification.delivery),
    ];
}
export function mergeStatisticsCompleteness(values) {
    const unavailable = values.flatMap((value) => value.kind === 'unavailable' ? value.reasons : []);
    if (unavailable.length)
        return { kind: 'unavailable', reasons: uniqueReasons(unavailable) };
    const partial = values.flatMap((value) => (value.kind === 'partial' ? value.reasons : []));
    return partial.length ? { kind: 'partial', reasons: uniqueReasons(partial) } : { kind: 'complete' };
}
export function sumSourceLines(values) {
    return values.reduce((total, value) => ({
        physical: total.physical + value.physical,
        code: total.code + value.code,
        comment: total.comment + value.comment,
        blank: total.blank + value.blank,
        unclassified: total.unclassified + value.unclassified,
    }), emptySourceLines());
}
function scalarGrouping(id, value) {
    return { id, values: (file) => [{ key: value(file) }] };
}
function uniqueValues(values) {
    return [...new Map(values.map((value) => [value.key, value])).values()].sort((left, right) => left.key.localeCompare(right.key));
}
function percentile(values, ratio) {
    if (!values.length)
        return 0;
    return values[Math.ceil(ratio * values.length) - 1] ?? values.at(-1) ?? 0;
}
function round(value) {
    return Math.round(value * 100) / 100;
}
function uniqueReasons(reasons) {
    return [...new Map(reasons.map((reason) => [`${reason.code}\u0000${reason.message}`, reason])).values()].sort((left, right) => left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
}
//# sourceMappingURL=aggregate.js.map