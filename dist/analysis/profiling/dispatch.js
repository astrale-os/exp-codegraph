import { ANALYSIS_TELEMETRY_FORMAT, } from './model.js';
export function dispatchAnalysisTelemetry(sink, event) {
    if (!sink)
        return;
    try {
        sink({ format: ANALYSIS_TELEMETRY_FORMAT, version: 1, ...event });
    }
    catch {
        // Measurement is deliberately diagnostic-only and cannot change analysis behavior.
    }
}
//# sourceMappingURL=dispatch.js.map