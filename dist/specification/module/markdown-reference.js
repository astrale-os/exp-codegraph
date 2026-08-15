import { markdownInlineCodeSpans } from '../../markdown/render.js';
const semanticPath = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*(?:\.[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*)*/u;
const MAX_SEMANTIC_CODE_CHARACTERS = 256;
/** Extract only code-shaped, unlinked Markdown mentions that may name a declaration. */
export function markdownSemanticMentions(document) {
    return markdownInlineCodeSpans(document).flatMap((span) => {
        if (span.linked)
            return [];
        const parsed = semanticMention(span.value);
        return parsed
            ? [
                {
                    from: span.from,
                    to: span.to,
                    text: document.text.slice(span.from, span.to),
                    ...parsed,
                },
            ]
            : [];
    });
}
function semanticMention(value) {
    if (value.length === 0 || value.length > MAX_SEMANTIC_CODE_CHARACTERS)
        return;
    const label = semanticPath.exec(value)?.[0];
    if (!label)
        return;
    const suffix = value.slice(label.length);
    if (!suffix)
        return { label, call: false };
    return balancedCall(suffix) ? { label, call: true } : undefined;
}
/** Accept arguments without treating arbitrary code expressions as references. */
function balancedCall(value) {
    if (value[0] !== '(' || value.at(-1) !== ')' || /[\r\n]/u.test(value))
        return false;
    const brackets = [];
    let quote;
    let escaped = false;
    const closing = { '(': ')', '[': ']', '{': '}' };
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (escaped)
                escaped = false;
            else if (character === '\\')
                escaped = true;
            else if (character === quote)
                quote = undefined;
            continue;
        }
        if (character === '"' || character === "'" || character === '`') {
            quote = character;
            continue;
        }
        if (closing[character])
            brackets.push(closing[character]);
        else if (character === ')' || character === ']' || character === '}') {
            if (brackets.pop() !== character)
                return false;
            if (brackets.length === 0 && index !== value.length - 1)
                return false;
        }
    }
    return !quote && brackets.length === 0;
}
//# sourceMappingURL=markdown-reference.js.map