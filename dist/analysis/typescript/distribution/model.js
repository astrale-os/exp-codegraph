export class NativeAnalysisDistributionError extends Error {
    name = 'NativeAnalysisDistributionError';
    code;
    target;
    constructor(code, message, target, options) {
        super(message, options);
        this.code = code;
        this.target = target;
    }
}
//# sourceMappingURL=model.js.map