import { deriveAnalysisId } from '../../identity/index.js';
import { stableJson } from '../../identity/model.js';
export function encodeSQLiteCursor(generation, filter, lastFact) {
    return Buffer.from(stableJson({ generation, filter: filterSignature(filter), lastFact })).toString('base64url');
}
export function decodeSQLiteCursor(cursor, generation, filter) {
    try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (decoded.generation !== generation ||
            decoded.filter !== filterSignature(filter) ||
            typeof decoded.lastFact !== 'string' ||
            !decoded.lastFact) {
            throw new Error();
        }
        return decoded.lastFact;
    }
    catch {
        throw new Error('Fact cursor is invalid or stale for this generation and filter.');
    }
}
function filterSignature(filter) {
    return deriveAnalysisId('fact', 'astrale.analysis.query-filter.v1', filter);
}
//# sourceMappingURL=cursor.js.map