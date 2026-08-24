import ts from 'typescript';
import { operationSnapshot, operationSnapshotNamespace } from '../../source/operation-snapshot.js';
const authoringSources = operationSnapshotNamespace('specification-authoring-syntax-sources');
/** Retain immutable source ASTs already parsed by the shared module compiler universe. */
export function markAuthoringSyntaxSources(sources) {
    const values = operationSnapshot(authoringSources);
    if (!values)
        return;
    for (const source of sources) {
        const current = values.get(source.source);
        if (current && current.text !== source.file.text) {
            throw new Error(`Authoring source changed during compilation: ${source.source}`);
        }
        const diagnostics = source.file.parseDiagnostics ?? [];
        values.set(source.source, { text: source.file.text, file: source.file, diagnostics });
    }
}
/** Reuse or create one exact standalone syntax analysis inside the coherent operation. */
export function operationAuthoringSyntaxAnalysis(source, text, create) {
    const values = operationSnapshot(authoringSources);
    if (!values)
        return;
    const current = values.get(source);
    if (current) {
        if (current.text !== text) {
            throw new Error(`Authoring source changed during compilation: ${source}`);
        }
        return current;
    }
    const created = create();
    values.set(source, { text, ...created });
    return created;
}
//# sourceMappingURL=authoring-syntax.optimization.js.map