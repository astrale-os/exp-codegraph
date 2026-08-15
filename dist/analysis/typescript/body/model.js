const BODY_OCCURRENCE_KINDS = new Set([
    'statement',
    'expression',
    'declaration',
    'assignment',
    'definition',
    'use',
    'call',
    'return',
    'throw',
    'branch',
    'external-escape',
]);
const CONTROL_FLOW_EDGE_KINDS = new Set([
    'fallthrough',
    'true',
    'false',
    'loop',
    'exception',
    'return',
]);
export function validateFunctionBodyIR(body) {
    const diagnostics = [];
    if (!body.function)
        diagnostics.push('BODY_FUNCTION_REQUIRED');
    const occurrences = new Set(body.occurrences.map((occurrence) => occurrence.id));
    if (occurrences.size !== body.occurrences.length)
        diagnostics.push('BODY_OCCURRENCE_DUPLICATE');
    for (const occurrence of body.occurrences) {
        if (!occurrence.id)
            diagnostics.push('BODY_OCCURRENCE_ID_REQUIRED');
        if (!BODY_OCCURRENCE_KINDS.has(occurrence.kind))
            diagnostics.push('BODY_OCCURRENCE_KIND_INVALID');
        if (occurrence.owner !== body.function)
            diagnostics.push('BODY_OCCURRENCE_OWNER_MISMATCH');
        if (!occurrence.syntax)
            diagnostics.push('BODY_OCCURRENCE_SYNTAX_REQUIRED');
        if (!occurrence.span.source ||
            !occurrence.span.revision ||
            !Number.isSafeInteger(occurrence.span.start) ||
            !Number.isSafeInteger(occurrence.span.end) ||
            occurrence.span.start < 0 ||
            occurrence.span.end <= occurrence.span.start)
            diagnostics.push('BODY_OCCURRENCE_SPAN_INVALID');
    }
    const blocks = new Set(body.blocks.map((block) => block.id));
    const occurrenceBlocks = new Map();
    if (blocks.size !== body.blocks.length)
        diagnostics.push('BODY_BLOCK_DUPLICATE');
    for (const block of body.blocks) {
        for (const occurrence of block.occurrences) {
            if (!occurrences.has(occurrence))
                diagnostics.push(`BODY_BLOCK_OCCURRENCE_UNKNOWN:${occurrence}`);
            occurrenceBlocks.set(occurrence, (occurrenceBlocks.get(occurrence) ?? 0) + 1);
        }
    }
    for (const occurrence of occurrences) {
        const count = occurrenceBlocks.get(occurrence) ?? 0;
        if (count === 0)
            diagnostics.push(`BODY_OCCURRENCE_UNASSIGNED:${occurrence}`);
        if (count > 1)
            diagnostics.push(`BODY_OCCURRENCE_MULTIPLE_BLOCKS:${occurrence}`);
    }
    const relations = new Set();
    for (const relation of body.relations) {
        if (!occurrences.has(relation.parent) || !occurrences.has(relation.child)) {
            diagnostics.push('BODY_RELATION_OCCURRENCE_UNKNOWN');
        }
        if (!relation.role)
            diagnostics.push('BODY_RELATION_ROLE_REQUIRED');
        const key = `${relation.parent}\0${relation.child}\0${relation.role}`;
        if (relations.has(key))
            diagnostics.push('BODY_RELATION_DUPLICATE');
        relations.add(key);
    }
    for (const edge of body.edges) {
        if (!blocks.has(edge.from) || !blocks.has(edge.to))
            diagnostics.push('BODY_EDGE_BLOCK_UNKNOWN');
        if (!CONTROL_FLOW_EDGE_KINDS.has(edge.kind))
            diagnostics.push('BODY_EDGE_KIND_INVALID');
        if (edge.evidence && !occurrences.has(edge.evidence))
            diagnostics.push('BODY_EDGE_EVIDENCE_UNKNOWN');
    }
    for (const relation of body.definitions) {
        if (!occurrences.has(relation.definition) || !occurrences.has(relation.use)) {
            diagnostics.push('BODY_DEFINITION_USE_UNKNOWN');
        }
        if (relation.reaching !== 'definite' && relation.reaching !== 'possible') {
            diagnostics.push('BODY_DEFINITION_REACHING_INVALID');
        }
    }
    for (const call of body.calls) {
        if (!occurrences.has(call.occurrence))
            diagnostics.push('BODY_CALL_OCCURRENCE_UNKNOWN');
        if (call.receiver && !occurrences.has(call.receiver))
            diagnostics.push('BODY_CALL_RECEIVER_UNKNOWN');
        for (const argument of call.arguments) {
            if (!occurrences.has(argument))
                diagnostics.push('BODY_CALL_ARGUMENT_UNKNOWN');
        }
        for (const binding of call.bindings) {
            if (!occurrences.has(binding.argument))
                diagnostics.push('BODY_BINDING_ARGUMENT_UNKNOWN');
            if (!Number.isSafeInteger(binding.index) || binding.index < 0) {
                diagnostics.push('BODY_BINDING_INDEX_INVALID');
            }
            if (typeof binding.rest !== 'boolean')
                diagnostics.push('BODY_BINDING_REST_INVALID');
        }
        if (typeof call.dynamic !== 'boolean')
            diagnostics.push('BODY_CALL_DYNAMIC_INVALID');
        if (call.typeArguments.some((argument) => !argument))
            diagnostics.push('BODY_CALL_TYPE_INVALID');
    }
    if (body.summary.function !== body.function)
        diagnostics.push('BODY_SUMMARY_FUNCTION_MISMATCH');
    for (const [name, values] of [
        ['RETURN', body.summary.returns],
        ['THROW', body.summary.throws],
        ['CALL', body.summary.calls],
        ['ESCAPE', body.summary.escapes],
    ]) {
        if (values.some((occurrence) => !occurrences.has(occurrence))) {
            diagnostics.push(`BODY_SUMMARY_${name}_UNKNOWN`);
        }
    }
    if (typeof body.summary.recursion !== 'boolean')
        diagnostics.push('BODY_SUMMARY_RECURSION_INVALID');
    return [...new Set(diagnostics)].sort();
}
//# sourceMappingURL=model.js.map