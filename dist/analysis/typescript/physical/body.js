import { validateFunctionBodyIR } from '../body/model.js';
export const TYPESCRIPT_BODY_PAYLOAD_CODEC_ID = 'typescript.body.packed/1';
export const TYPESCRIPT_BODY_PAYLOAD_CODEC = Object.freeze({
    id: TYPESCRIPT_BODY_PAYLOAD_CODEC_ID,
    decode: decodePackedTypeScriptBody,
});
export const TYPESCRIPT_FACT_PAYLOAD_CODECS = Object.freeze([
    TYPESCRIPT_BODY_PAYLOAD_CODEC,
]);
function decodePackedTypeScriptBody(input) {
    const packed = exactRecord(input, ['c', 's', 't', 'p', 'o', 'r', 'b', 'e', 'd', 'a', 'u', 'v', 'q'], 'body payload');
    const constants = exactTuple(packed.c, 3, 'constants');
    const source = expandId(constants[0], 'source');
    const revision = expandId(constants[1], 'source-revision');
    const owner = expandId(constants[2], 'symbol');
    const symbols = uniqueStrings(packed.s, 'symbols').map((entry) => expandId(entry, 'symbol'));
    const texts = uniqueStrings(packed.t, 'texts');
    const symbol = (value, path) => symbols[ordinal(value, symbols.length, path)];
    const text = (value, path) => texts[ordinal(value, texts.length, path)];
    const occurrences = packed.o.map((value, index) => {
        const row = exactTuple(value, 6, `occurrences[${index}]`);
        const symbolIndex = optionalOrdinal(row[5], symbols.length, `occurrences[${index}].symbol`);
        return {
            id: expandId(row[0], 'occurrence'),
            kind: text(row[1], `occurrences[${index}].kind`),
            span: {
                source,
                revision,
                start: integer(row[2], 0, `occurrences[${index}].start`),
                end: integer(row[3], 1, `occurrences[${index}].end`),
            },
            owner,
            syntax: text(row[4], `occurrences[${index}].syntax`),
            ...(symbolIndex === undefined ? {} : { symbol: symbols[symbolIndex] }),
        };
    });
    unique(occurrences.map((entry) => entry.id), 'occurrence identities');
    const occurrence = (value, path) => occurrences[ordinal(value, occurrences.length, path)].id;
    const parameters = packed.p.map((entry, index) => symbol(entry, `parameters[${index}]`));
    const relations = packed.r.map((value, index) => {
        const row = exactTuple(value, 3, `relations[${index}]`);
        return {
            parent: occurrence(row[0], `relations[${index}].parent`),
            child: occurrence(row[1], `relations[${index}].child`),
            role: text(row[2], `relations[${index}].role`),
        };
    });
    const blocks = packed.b.map((value, index) => {
        const row = exactTuple(value, 2, `blocks[${index}]`);
        return {
            id: text(row[0], `blocks[${index}].id`),
            occurrences: array(row[1], `blocks[${index}].occurrences`).map((entry, occurrenceIndex) => occurrence(entry, `blocks[${index}].occurrences[${occurrenceIndex}]`)),
        };
    });
    unique(blocks.map((entry) => entry.id), 'block identities');
    const block = (value, path) => blocks[ordinal(value, blocks.length, path)].id;
    const edges = packed.e.map((value, index) => {
        const row = exactTuple(value, 4, `edges[${index}]`);
        const evidence = optionalOrdinal(row[3], occurrences.length, `edges[${index}].evidence`);
        return {
            from: block(row[0], `edges[${index}].from`),
            to: block(row[1], `edges[${index}].to`),
            kind: text(row[2], `edges[${index}].kind`),
            ...(evidence === undefined ? {} : { evidence: occurrences[evidence].id }),
        };
    });
    const definitions = packed.d.map((value, index) => {
        const row = exactTuple(value, 4, `definitions[${index}]`);
        const definitionSymbol = optionalOrdinal(row[2], symbols.length, `definitions[${index}].symbol`);
        return {
            definition: occurrence(row[0], `definitions[${index}].definition`),
            use: occurrence(row[1], `definitions[${index}].use`),
            ...(definitionSymbol === undefined ? {} : { symbol: symbols[definitionSymbol] }),
            reaching: text(row[3], `definitions[${index}].reaching`),
        };
    });
    const calls = packed.a.map((value, index) => {
        const row = exactTuple(value, 9, `calls[${index}]`);
        const target = optionalOrdinal(row[1], symbols.length, `calls[${index}].target`);
        const signature = optionalOrdinal(row[2], texts.length, `calls[${index}].signature`);
        const receiver = optionalOrdinal(row[3], occurrences.length, `calls[${index}].receiver`);
        return {
            occurrence: occurrence(row[0], `calls[${index}].occurrence`),
            ...(target === undefined ? {} : { target: symbols[target] }),
            ...(signature === undefined ? {} : { signature: texts[signature] }),
            ...(receiver === undefined ? {} : { receiver: occurrences[receiver].id }),
            typeArguments: array(row[4], `calls[${index}].typeArguments`).map((entry, valueIndex) => text(entry, `calls[${index}].typeArguments[${valueIndex}]`)),
            arguments: array(row[5], `calls[${index}].arguments`).map((entry, valueIndex) => occurrence(entry, `calls[${index}].arguments[${valueIndex}]`)),
            bindings: array(row[6], `calls[${index}].bindings`).map((entry, bindingIndex) => {
                const binding = exactTuple(entry, 4, `calls[${index}].bindings[${bindingIndex}]`);
                const parameter = optionalOrdinal(binding[1], symbols.length, `calls[${index}].bindings[${bindingIndex}].parameter`);
                return {
                    argument: occurrence(binding[0], `calls[${index}].bindings[${bindingIndex}].argument`),
                    ...(parameter === undefined ? {} : { parameter: symbols[parameter] }),
                    index: integer(binding[2], 0, `calls[${index}].bindings[${bindingIndex}].index`),
                    rest: bit(binding[3], `calls[${index}].bindings[${bindingIndex}].rest`),
                };
            }),
            callbacks: array(row[7], `calls[${index}].callbacks`).map((entry, valueIndex) => symbol(entry, `calls[${index}].callbacks[${valueIndex}]`)),
            dynamic: bit(row[8], `calls[${index}].dynamic`),
        };
    });
    const summary = exactTuple(packed.u, 6, 'summary');
    const body = {
        function: owner,
        parameters,
        occurrences,
        relations,
        blocks,
        edges,
        definitions,
        calls,
        summary: {
            function: owner,
            returns: occurrenceArray(summary[0], occurrences, 'summary.returns'),
            throws: occurrenceArray(summary[1], occurrences, 'summary.throws'),
            captures: array(summary[2], 'summary.captures').map((entry, index) => symbol(entry, `summary.captures[${index}]`)),
            calls: occurrenceArray(summary[3], occurrences, 'summary.calls'),
            escapes: occurrenceArray(summary[4], occurrences, 'summary.escapes'),
            recursion: bit(summary[5], 'summary.recursion'),
        },
    };
    const diagnostics = validateFunctionBodyIR(body);
    if (diagnostics.length) {
        throw new TypeError(`Packed TypeScript body is semantically invalid: ${diagnostics.join(', ')}`);
    }
    const values = {};
    const valueOccurrences = new Set();
    for (const [index, value] of packed.v.entries()) {
        const row = exactTuple(value, 2, `values[${index}]`);
        const key = ordinal(row[0], occurrences.length, `values[${index}].occurrence`);
        if (valueOccurrences.has(key))
            throw new TypeError('Packed TypeScript body repeats a value occurrence.');
        valueOccurrences.add(key);
        values[occurrences[key].id] = admitValueResult(row[1], `values[${index}].value`);
    }
    return { body, values, completeness: admitCompleteness(packed.q, 'completeness') };
}
function admitCompleteness(value, path) {
    const input = record(value, path);
    if (input.kind === 'complete') {
        exactKeys(input, ['kind'], path);
        return { kind: 'complete' };
    }
    if (input.kind === 'partial') {
        exactKeys(input, ['kind', 'reasons'], path);
        return {
            kind: 'partial',
            reasons: array(input.reasons, `${path}.reasons`).map((reason, index) => admitLimit(reason, `${path}.reasons[${index}]`)),
        };
    }
    if (input.kind === 'unavailable') {
        exactKeys(input, ['kind', 'reasons'], path);
        return {
            kind: 'unavailable',
            reasons: array(input.reasons, `${path}.reasons`).map((reason, index) => admitFailure(reason, `${path}.reasons[${index}]`)),
        };
    }
    throw new TypeError(`Packed ${path}.kind is invalid.`);
}
function admitValueResult(value, path) {
    const input = record(value, path);
    const evidence = factIdentities(input.evidence, `${path}.evidence`);
    if (input.kind === 'known') {
        exactKeys(input, ['kind', 'value', 'evidence'], path);
        if (!Object.hasOwn(input, 'value'))
            throw new TypeError(`Packed ${path}.value is required.`);
        return { kind: 'known', value: input.value, evidence };
    }
    if (input.kind === 'unknown') {
        exactKeys(input, ['kind', 'reasons', 'evidence'], path);
        return {
            kind: 'unknown',
            reasons: array(input.reasons, `${path}.reasons`).map((reason, index) => admitFailure(reason, `${path}.reasons[${index}]`)),
            evidence,
        };
    }
    if (input.kind === 'ambiguous') {
        exactKeys(input, ['kind', 'values', 'reasons', 'evidence'], path);
        return {
            kind: 'ambiguous',
            values: array(input.values, `${path}.values`),
            reasons: array(input.reasons, `${path}.reasons`).map((reason, index) => admitLimit(reason, `${path}.reasons[${index}]`)),
            evidence,
        };
    }
    if (input.kind === 'unsupported') {
        exactKeys(input, ['kind', 'construct', 'evidence'], path);
        if (typeof input.construct !== 'string' || !input.construct) {
            throw new TypeError(`Packed ${path}.construct is invalid.`);
        }
        return { kind: 'unsupported', construct: input.construct, evidence };
    }
    throw new TypeError(`Packed ${path}.kind is invalid.`);
}
function admitLimit(value, path) {
    const input = record(value, path);
    exactKeys(input, ['code', 'message', 'effective'], path);
    if (typeof input.code !== 'string' || !input.code || typeof input.message !== 'string' || !input.message) {
        throw new TypeError(`Packed ${path} has an invalid code or message.`);
    }
    const admitted = record(input.effective, `${path}.effective`);
    if (Object.values(admitted).some((entry) => typeof entry !== 'number' && typeof entry !== 'string' && typeof entry !== 'boolean'))
        throw new TypeError(`Packed ${path}.effective is invalid.`);
    const effective = admitted;
    return { code: input.code, message: input.message, effective };
}
function admitFailure(value, path) {
    const input = record(value, path);
    const keys = input.attributableTo === undefined
        ? ['code', 'message', 'retryable']
        : ['code', 'message', 'attributableTo', 'retryable'];
    exactKeys(input, keys, path);
    if (typeof input.code !== 'string' ||
        !input.code ||
        typeof input.message !== 'string' ||
        !input.message ||
        typeof input.retryable !== 'boolean' ||
        (input.attributableTo !== undefined && !analysisIdentity(input.attributableTo, 'pass')))
        throw new TypeError(`Packed ${path} is invalid.`);
    return {
        code: input.code,
        message: input.message,
        ...(input.attributableTo === undefined ? {} : { attributableTo: input.attributableTo }),
        retryable: input.retryable,
    };
}
function factIdentities(value, path) {
    return array(value, path).map((entry) => {
        if (!analysisIdentity(entry, 'fact'))
            throw new TypeError(`Packed ${path} is invalid.`);
        return entry;
    });
}
function analysisIdentity(value, kind) {
    return typeof value === 'string' && new RegExp(`^${kind}:[a-f0-9]{64}$`, 'u').test(value);
}
function record(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`Packed ${path} must be an object.`);
    }
    return value;
}
function exactKeys(value, keys, path) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new TypeError(`Packed ${path} fields are invalid.`);
    }
}
function occurrenceArray(value, occurrences, path) {
    return array(value, path).map((entry, index) => occurrences[ordinal(entry, occurrences.length, `${path}[${index}]`)].id);
}
function expandId(value, kind) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
        throw new TypeError(`Packed ${kind} identity is invalid.`);
    }
    const digest = Buffer.from(value, 'base64url');
    if (digest.byteLength !== 32 || digest.toString('base64url') !== value) {
        throw new TypeError(`Packed ${kind} identity is not canonical.`);
    }
    return `${kind}:${digest.toString('hex')}`;
}
function exactRecord(value, keys, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`Packed ${path} must be an object.`);
    }
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new TypeError(`Packed ${path} fields are invalid.`);
    }
    return value;
}
function exactTuple(value, length, path) {
    const tuple = array(value, path);
    if (tuple.length !== length)
        throw new TypeError(`Packed ${path} must have ${length} entries.`);
    return tuple;
}
function array(value, path) {
    if (!Array.isArray(value))
        throw new TypeError(`Packed ${path} must be an array.`);
    return value;
}
function uniqueStrings(values, path) {
    if (values.some((value) => typeof value !== 'string')) {
        throw new TypeError(`Packed ${path} must contain strings.`);
    }
    const result = values;
    unique(result, path);
    return result;
}
function unique(values, path) {
    if (new Set(values).size !== values.length)
        throw new TypeError(`Packed ${path} are duplicated.`);
}
function ordinal(value, length, path) {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= length) {
        throw new TypeError(`Packed ${path} is outside its dictionary.`);
    }
    return Number(value);
}
function optionalOrdinal(value, length, path) {
    if (value === -1)
        return undefined;
    return ordinal(value, length, path);
}
function integer(value, minimum, path) {
    if (!Number.isSafeInteger(value) || Number(value) < minimum) {
        throw new TypeError(`Packed ${path} is not an integer >= ${minimum}.`);
    }
    return Number(value);
}
function bit(value, path) {
    if (value !== 0 && value !== 1)
        throw new TypeError(`Packed ${path} must be 0 or 1.`);
    return value === 1;
}
//# sourceMappingURL=body.js.map