export interface TaskLimiter {
    run<Result>(task: () => Promise<Result>): Promise<Result>;
}
/** Bound concurrent resource use without coupling the task implementation to queueing policy. */
export declare function createTaskLimiter(concurrency: number): TaskLimiter;
