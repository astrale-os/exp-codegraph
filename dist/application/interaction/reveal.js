/** Generation-pinned application specification reveal transport. */
export const SPEC_REVEAL_PROTOCOL = 'astrale.spec.reveal.v2';
export const SPEC_REVEAL_ENDPOINT = '/__astrale/spec-reveal';
export const SPEC_REVEAL_HEADER = 'x-astrale-spec-reveal';
export class SpecRevealAdapterError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'SpecRevealAdapterError';
        this.code = code;
    }
}
//# sourceMappingURL=reveal.js.map