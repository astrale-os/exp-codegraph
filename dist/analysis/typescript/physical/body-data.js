/** One private cell; every assigned property is owned even when an option is absent. */
export function createOccurrenceScratch(source, revision, owner) {
    return {
        id: '', kind: 'statement',
        span: { source, revision, start: 0, end: 0 }, owner, syntax: '',
        symbol: undefined,
        symbolOrigin: undefined,
        operator: undefined,
        symbolKind: undefined,
        propertyName: undefined,
        propertyNamespace: undefined,
    };
}
export function decodeRelation(value, index, occurrence, text, result) {
    const row = exactTuple(value, 3, `relations[${index}]`);
    const parent = occurrence(row[0], `relations[${index}].parent`);
    const child = occurrence(row[1], `relations[${index}].child`);
    const role = text(row[2], `relations[${index}].role`);
    if (!result)
        return { parent, child, role };
    result.parent = parent;
    result.child = child;
    result.role = role;
    return result;
}
export function decodeBlock(value, index, occurrence, text) {
    const row = exactTuple(value, 2, `blocks[${index}]`);
    return { id: text(row[0], `blocks[${index}].id`),
        occurrences: Array.from(array(row[1], `blocks[${index}].occurrences`), (entry, occurrenceIndex) => occurrence(entry, `blocks[${index}].occurrences[${occurrenceIndex}]`)) };
}
export function decodeEdge(value, index, occurrenceCount, occurrenceIds, block, text, result) {
    const row = exactTuple(value, 4, `edges[${index}]`);
    const evidence = optionalOrdinal(row[3], occurrenceCount, `edges[${index}].evidence`);
    const from = block(row[0], `edges[${index}].from`);
    const to = block(row[1], `edges[${index}].to`);
    const kind = text(row[2], `edges[${index}].kind`);
    if (!result)
        return { from, to, kind, ...(evidence === undefined ? {} : { evidence: occurrenceIds[evidence] }) };
    result.from = from;
    result.to = to;
    result.kind = kind;
    result.evidence = evidence === undefined ? undefined : occurrenceIds[evidence];
    return result;
}
export function decodeDefinition(value, index, symbols, occurrence, text, result) {
    const row = exactTuple(value, 4, `definitions[${index}]`);
    const symbol = optionalOrdinal(row[2], symbols.length, `definitions[${index}].symbol`);
    const definition = occurrence(row[0], `definitions[${index}].definition`);
    const use = occurrence(row[1], `definitions[${index}].use`);
    const symbolValue = symbol === undefined ? undefined : symbols[symbol];
    const reaching = text(row[3], `definitions[${index}].reaching`);
    if (!result)
        return { definition, use, ...(symbol === undefined ? {} : { symbol: symbolValue }), reaching };
    result.definition = definition;
    result.use = use;
    result.symbol = symbolValue;
    result.reaching = reaching;
    return result;
}
export function decodeSummary(value, owner, occurrences, symbol) {
    const row = exactTuple(value, 6, 'summary');
    return {
        function: owner,
        returns: occurrenceArray(row[0], occurrences, 'summary.returns'),
        throws: occurrenceArray(row[1], occurrences, 'summary.throws'),
        captures: Array.from(array(row[2], 'summary.captures'), (entry, index) => symbol(entry, `summary.captures[${index}]`)),
        calls: occurrenceArray(row[3], occurrences, 'summary.calls'),
        escapes: occurrenceArray(row[4], occurrences, 'summary.escapes'),
        recursion: bit(row[5], 'summary.recursion'),
    };
}
export function decodeOccurrence(value, index, version, source, revision, owner, symbols, texts, scratch) {
    const text = (value, path) => texts[ordinal(value, texts.length, path)];
    const row = exactTuple(value, version >= 5 ? 11 : version >= 4 ? 8 : version >= 3 ? 7 : 6, `occurrences[${index}]`);
    const symbolIndex = optionalOrdinal(row[5], symbols.length, `occurrences[${index}].symbol`);
    const operatorIndex = version < 4 ? undefined : optionalOrdinal(row[7], texts.length, `occurrences[${index}].operator`);
    const symbolKindIndex = version < 5 ? undefined : optionalOrdinal(row[8], texts.length, `occurrences[${index}].symbolKind`);
    const propertyNameIndex = version < 5 ? undefined : optionalOrdinal(row[9], texts.length, `occurrences[${index}].propertyName`);
    const propertyNamespaceIndex = version < 5 ? undefined : optionalOrdinal(row[10], symbols.length, `occurrences[${index}].propertyNamespace`);
    const id = expandId(row[0], 'occurrence');
    const kind = text(row[1], `occurrences[${index}].kind`);
    const start = integer(row[2], 0, `occurrences[${index}].start`);
    const end = integer(row[3], 1, `occurrences[${index}].end`);
    const syntax = text(row[4], `occurrences[${index}].syntax`);
    const symbol = symbolIndex === undefined ? undefined : symbols[symbolIndex];
    const symbolOrigin = version < 3 || row[6] === null ? undefined : admitSymbolOrigin(row[6]);
    const operator = operatorIndex === undefined ? undefined : texts[operatorIndex];
    const symbolKind = symbolKindIndex === undefined ? undefined : texts[symbolKindIndex];
    const propertyName = propertyNameIndex === undefined ? undefined : texts[propertyNameIndex];
    const propertyNamespace = propertyNamespaceIndex === undefined ? undefined : symbols[propertyNamespaceIndex];
    if (!scratch)
        return {
            id, kind, span: { source, revision, start, end }, owner, syntax,
            ...(symbolIndex === undefined ? {} : { symbol: symbol }),
            ...(symbolOrigin === undefined ? {} : { symbolOrigin }),
            ...(operatorIndex === undefined ? {} : { operator: operator }),
            ...(symbolKindIndex === undefined ? {} : { symbolKind: symbolKind }),
            ...(propertyNameIndex === undefined ? {} : { propertyName: propertyName }),
            ...(propertyNamespaceIndex === undefined ? {} : { propertyNamespace: propertyNamespace }),
        };
    scratch.id = id;
    scratch.kind = kind;
    scratch.span.source = source;
    scratch.span.revision = revision;
    scratch.span.start = start;
    scratch.span.end = end;
    scratch.owner = owner;
    scratch.syntax = syntax;
    scratch.symbol = symbol;
    scratch.symbolOrigin = symbolOrigin;
    scratch.operator = operator;
    scratch.symbolKind = symbolKind;
    scratch.propertyName = propertyName;
    scratch.propertyNamespace = propertyNamespace;
    return scratch;
}
export function decodeCall(value, index, version, symbols, texts, occurrenceCount, occurrence) {
    const symbol = (value, path) => symbols[ordinal(value, symbols.length, path)];
    const text = (value, path) => texts[ordinal(value, texts.length, path)];
    const row = exactTuple(value, version === 1 ? 9 : 10, `calls[${index}]`);
    const target = optionalOrdinal(row[1], symbols.length, `calls[${index}].target`);
    const signature = optionalOrdinal(row[2], texts.length, `calls[${index}].signature`);
    const receiver = optionalOrdinal(row[3], occurrenceCount, `calls[${index}].receiver`);
    return {
        occurrence: occurrence(row[0], `calls[${index}].occurrence`),
        ...(target === undefined ? {} : { target: symbols[target] }),
        ...(version === 1 || row[9] === null ? {} : { targetOrigin: admitSymbolOrigin(row[9]) }),
        ...(signature === undefined ? {} : { signature: texts[signature] }),
        ...(receiver === undefined ? {} : { receiver: occurrence(receiver, `calls[${index}].receiver`) }),
        typeArguments: Array.from(array(row[4], `calls[${index}].typeArguments`), (entry, valueIndex) => text(entry, `calls[${index}].typeArguments[${valueIndex}]`)),
        arguments: Array.from(array(row[5], `calls[${index}].arguments`), (entry, valueIndex) => occurrence(entry, `calls[${index}].arguments[${valueIndex}]`)),
        bindings: Array.from(array(row[6], `calls[${index}].bindings`), (entry, bindingIndex) => {
            const binding = exactTuple(entry, 4, `calls[${index}].bindings[${bindingIndex}]`);
            const parameter = optionalOrdinal(binding[1], symbols.length, `calls[${index}].bindings[${bindingIndex}].parameter`);
            return {
                argument: occurrence(binding[0], `calls[${index}].bindings[${bindingIndex}].argument`),
                ...(parameter === undefined ? {} : { parameter: symbols[parameter] }),
                index: integer(binding[2], 0, `calls[${index}].bindings[${bindingIndex}].index`),
                rest: bit(binding[3], `calls[${index}].bindings[${bindingIndex}].rest`),
            };
        }),
        callbacks: Array.from(array(row[7], `calls[${index}].callbacks`), (entry, valueIndex) => symbol(entry, `calls[${index}].callbacks[${valueIndex}]`)),
        dynamic: bit(row[8], `calls[${index}].dynamic`),
    };
}
export function admitSymbolOrigin(input) {
    const value = exactRecord(input, ['package', 'file', 'path'], 'symbol origin');
    if (typeof value.package !== 'string' || !value.package || typeof value.file !== 'string' || !value.file ||
        !Array.isArray(value.path) || !value.path.length || value.path.some((part) => typeof part !== 'string' || !part)) {
        throw new TypeError('Packed TypeScript symbol origin is invalid.');
    }
    return { package: value.package, file: value.file, path: Array.from(value.path) };
}
export function admitCompleteness(value, path) {
    const input = record(value, path);
    if (input.kind === 'complete') {
        exactKeys(input, ['kind'], path);
        return { kind: 'complete' };
    }
    if (input.kind === 'partial') {
        exactKeys(input, ['kind', 'reasons'], path);
        return {
            kind: 'partial',
            reasons: Array.from(array(input.reasons, `${path}.reasons`), (reason, index) => admitLimit(reason, `${path}.reasons[${index}]`)),
        };
    }
    if (input.kind === 'unavailable') {
        exactKeys(input, ['kind', 'reasons'], path);
        return {
            kind: 'unavailable',
            reasons: Array.from(array(input.reasons, `${path}.reasons`), (reason, index) => admitFailure(reason, `${path}.reasons[${index}]`)),
        };
    }
    throw new TypeError(`Packed ${path}.kind is invalid.`);
}
export function admitValueResult(value, path) {
    const input = record(value, path);
    const evidence = factIdentities(input.evidence, `${path}.evidence`);
    if (input.kind === 'known') {
        exactKeys(input, ['kind', 'value', 'evidence'], path);
        if (!Object.hasOwn(input, 'value'))
            throw new TypeError(`Packed ${path}.value is required.`);
        return { kind: 'known', value: ownedValue(input.value), evidence };
    }
    if (input.kind === 'unknown') {
        exactKeys(input, ['kind', 'reasons', 'evidence'], path);
        return {
            kind: 'unknown',
            reasons: Array.from(array(input.reasons, `${path}.reasons`), (reason, index) => admitFailure(reason, `${path}.reasons[${index}]`)),
            evidence,
        };
    }
    if (input.kind === 'ambiguous') {
        exactKeys(input, ['kind', 'values', 'reasons', 'evidence'], path);
        return {
            kind: 'ambiguous',
            values: Array.from(array(input.values, `${path}.values`), ownedValue),
            reasons: Array.from(array(input.reasons, `${path}.reasons`), (reason, index) => admitLimit(reason, `${path}.reasons[${index}]`)),
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
export function admitLimit(value, path) {
    const input = record(value, path);
    exactKeys(input, ['code', 'message', 'effective'], path);
    if (typeof input.code !== 'string' || !input.code || typeof input.message !== 'string' || !input.message) {
        throw new TypeError(`Packed ${path} has an invalid code or message.`);
    }
    const admitted = { ...record(input.effective, `${path}.effective`) };
    if (Object.values(admitted).some((entry) => typeof entry !== 'number' && typeof entry !== 'string' && typeof entry !== 'boolean'))
        throw new TypeError(`Packed ${path}.effective is invalid.`);
    const effective = admitted;
    return { code: input.code, message: input.message, effective };
}
// The packed format is JSON data. Snapshot its open value fragments while decoding,
// so the owned output never retains an input container or a live accessor.
export function ownedValue(value) {
    if (typeof value === 'function')
        throw new TypeError('Packed values must be data.');
    if (value === null || typeof value !== 'object')
        return value;
    return Array.isArray(value)
        ? Array.from(value, ownedValue)
        : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, ownedValue(entry)]));
}
export function admitFailure(value, path) {
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
export function factIdentities(value, path) {
    return Array.from(array(value, path), (entry) => {
        if (!analysisIdentity(entry, 'fact'))
            throw new TypeError(`Packed ${path} is invalid.`);
        return entry;
    });
}
export function analysisIdentity(value, kind) {
    return typeof value === 'string' && new RegExp(`^${kind}:[a-f0-9]{64}$`, 'u').test(value);
}
export function record(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`Packed ${path} must be an object.`);
    }
    return value;
}
export function exactKeys(value, keys, path) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new TypeError(`Packed ${path} fields are invalid.`);
    }
}
export function occurrenceArray(value, occurrences, path) {
    return Array.from(array(value, path), (entry, index) => occurrences[ordinal(entry, occurrences.length, `${path}[${index}]`)]);
}
export function expandId(value, kind) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
        throw new TypeError(`Packed ${kind} identity is invalid.`);
    }
    const digest = Buffer.from(value, 'base64url');
    if (digest.byteLength !== 32 || digest.toString('base64url') !== value) {
        throw new TypeError(`Packed ${kind} identity is not canonical.`);
    }
    return `${kind}:${digest.toString('hex')}`;
}
export function exactRecord(value, keys, path) {
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
export function exactTuple(value, length, path) {
    const tuple = array(value, path);
    if (tuple.length !== length)
        throw new TypeError(`Packed ${path} must have ${length} entries.`);
    return tuple;
}
export function array(value, path) {
    if (!Array.isArray(value))
        throw new TypeError(`Packed ${path} must be an array.`);
    return value;
}
export function uniqueStrings(values, path) {
    const copied = Array.from(array(values, path));
    if (copied.some((value) => typeof value !== 'string')) {
        throw new TypeError(`Packed ${path} must contain strings.`);
    }
    const result = copied;
    unique(result, path);
    return result;
}
export function unique(values, path) {
    if (new Set(values).size !== values.length)
        throw new TypeError(`Packed ${path} are duplicated.`);
}
export function ordinal(value, length, path) {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= length) {
        throw new TypeError(`Packed ${path} is outside its dictionary.`);
    }
    return Number(value);
}
export function optionalOrdinal(value, length, path) {
    if (value === -1)
        return undefined;
    return ordinal(value, length, path);
}
export function integer(value, minimum, path) {
    if (!Number.isSafeInteger(value) || Number(value) < minimum) {
        throw new TypeError(`Packed ${path} is not an integer >= ${minimum}.`);
    }
    return Number(value);
}
export function bit(value, path) {
    if (value !== 0 && value !== 1)
        throw new TypeError(`Packed ${path} must be 0 or 1.`);
    return value === 1;
}
//# sourceMappingURL=body-data.js.map