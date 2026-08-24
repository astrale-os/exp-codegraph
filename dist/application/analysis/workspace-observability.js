import { dispatchAnalysisTelemetry } from '../../analysis/profiling/dispatch.js';
/** Attribute one compiler lifecycle without weakening or relabeling its failure. */
export async function observeCompilerProject(telemetry, project, operation) {
    const started = performance.now();
    emit(telemetry, project, 'started');
    try {
        const result = await operation();
        emit(telemetry, project, 'completed', started);
        return result;
    }
    catch (error) {
        emit(telemetry, project, 'failed', started, error instanceof Error ? error.name : 'unknown');
        throw error;
    }
}
function emit(telemetry, project, status, started, error) {
    dispatchAnalysisTelemetry(telemetry, {
        component: 'analysis',
        phase: 'application.compiler-project',
        ...(started === undefined ? {} : { durationNs: Math.round((performance.now() - started) * 1_000_000) }),
        metrics: { status, project, ...(error ? { error } : {}) },
    });
}
//# sourceMappingURL=workspace-observability.js.map