export const VERIFICATION_PROTOCOL = 'astrale.spec.verification.v2';
export const VERIFICATION_ENDPOINT = '/__astrale/spec-verification';
export const VERIFICATION_HEADER = 'x-astrale-spec-verification';
export class VerificationAdapterError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'VerificationAdapterError';
        this.code = code;
    }
}
//# sourceMappingURL=qualification.js.map