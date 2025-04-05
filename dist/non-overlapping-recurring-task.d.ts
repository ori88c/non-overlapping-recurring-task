/**
 * Copyright 2025 Ori Cohen https://github.com/ori88c
 * https://github.com/ori88c/non-overlapping-recurring-task
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Configuration options for a `NonOverlappingRecurringTask`.
 */
export interface INonOverlappingRecurringTaskOptions {
    /**
     * A positive number representing the interval, in milliseconds, between the
     * **start times** of consecutive execution attempts.
     *
     * The term "attempts" is used because, due to this component's **non-overlapping**
     * nature, an attempt may be skipped if a previous execution is still ongoing.
     */
    intervalMs: number;
    /**
     * When set to `true`, the first execution occurs **immediately** upon calling `start()`.
     * Otherwise, similar to `setInterval`, the scheduler waits for the first interval before
     * executing.
     */
    immediateFirstRun: boolean;
}
export type ActivityStatus = 'active' | 'inactive' | 'terminating';
/**
 * The `NonOverlappingRecurringTask` class provides a recurring asynchronous task scheduler
 * with a focus on the following key aspects:
 * 1. **Guaranteed Non-Overlapping Executions**.
 * 2. **Graceful and Deterministic Teardown**.
 * 3. **Fixed Delay Between Executions**, similar to JavaScript's built-in `setInterval`.
 *
 * ### Non-Overlapping Executions
 * Ensures that task executions do not overlap, preventing race conditions and potential
 * performance issues.
 * In many cases, recurring tasks are assumed to never overlap due to a sufficiently long
 * interval. As a result, the task's business logic may not account for overlapping executions.
 * By **eliminating this possibility at the scheduler level**, the task can focus solely on its
 * intended logic without the need for additional safeguards.
 * This built-in guarantee reinforces Separation of Concerns and the Single Responsibility
 * Principle, enhancing overall robustness.
 *
 * ### Graceful and Deterministic Teardown
 * Task execution promises are tracked by the instance, ensuring no dangling promises. This
 * enables a graceful teardown via the `stop` method, in scenarios where it is essential to
 * **ensure that any ongoing execution is completed before proceeding**.
 * Examples include:
 * - Application shutdowns (e.g., `onModuleDestroy` in NestJS applications) where tasks should
 *   complete before termination. For instance, ensuring a bulk-write to a database is finished
 *   instead of abruptly terminating the operation by forcefully exiting the application.
 * - Unit tests, where a clean state is essential to prevent ongoing tasks from interfering with
 *   subsequent tests.
 *
 * ### Fixed Delay Between Executions, similar to JavaScript's built-in `setInterval`
 * Like JavaScript’s built-in `setInterval`, this scheduler ensures a **fixed interval between
 * execution start times**. That is, for an absolute timestamp T, execution start times follow
 * the formula `T + i * intervalMs` where i is a non-negative integer.
 * However, there are two key differences:
 * - Immediate First Run (`immediateFirstRun` flag):
 *   When enabled, the first execution occurs immediately after invoking `start`. In contrast,
 *   `setInterval` waits for the first interval before executing.
 * - Non-Overlapping Guarantee:
 *   If an execution exceeds the interval duration, subsequent executions are skipped until the
 *   ongoing execution completes.
 *
 * #### Example
 * - Suppose `T` is the timestamp when `start` is invoked, the interval is 100ms, and
 *   `immediateFirstRun` is enabled.
 * - The first execution starts immediately and runs for **350ms**.
 * - Since start times adhere to the formula `T + 100 * i`, the scheduler **skips** cycles
 *   where i = 1,2,3.
 * - The next execution begins at `T + 400ms`.
 *
 * ### Zero Over-Engineering, No External Dependencies
 * While `setInterval` is useful for recurring tasks, it falls short for asynchronous tasks
 * due to **overlapping executions** and **non-deterministic termination** of the last execution.
 * Many custom solutions or third-party libraries introduce **unnecessary runtime dependencies**,
 * increasing project size and complexity.
 * This class provides a **lightweight, dependency-free solution** while ensuring predictable
 * execution. Additionally, it can serve as a foundation for more advanced implementations if
 * needed.
 *
 * ### Error Handling
 * If a periodic task throws an error, it is passed to an optional error handler callback, if
 * provided. This component does **not** perform any logging, as it is designed to be agnostic
 * of user preferences, such as specific loggers or logging styles.
 * A typical `_onTaskError` implementation logs errors based on the user's logging strategy.
 * If the periodic task already handles its own errors, this handler can be omitted.
 *
 * ### Tests
 * This class is fully covered by extensive unit tests.
 */
export declare class NonOverlappingRecurringTask<UncaughtErrorType = Error> {
    private readonly _asyncTask;
    private readonly _options;
    private readonly _onTaskError?;
    private _status;
    private _timerHandle?;
    private _currentExecutionPromise?;
    /**
     * @param _asyncTask An asynchronous task to be executed periodically.
     * @param _options Execution options. Refer to the `NonOverlappingRecurringTaskOptions`
     *                 documentation for detailed information.
     * @param _onTaskError (Optional) An error handler for cases where the task might reject
     *                     with an error. This handler should **not throw**, as doing so would
     *                     cause the error to propagate up the event loop, potentially crashing
     *                     the application.
     * @throws Error if any of the provided parameters are invalid.
     */
    constructor(_asyncTask: () => Promise<void>, _options: Readonly<INonOverlappingRecurringTaskOptions>, _onTaskError?: (err: UncaughtErrorType) => void);
    /**
     * Returns the current instance status, which can be one of the following:
     * - `active`: Currently managing recurring executions.
     * - `inactive`: Not managing any recurring executions.
     * - `terminating`: A stop attempt was made, but the last execution from the
     *    previous session is still ongoing.
     *
     * @returns One of the following values: 'active', 'inactive', or 'terminating'.
     */
    get status(): ActivityStatus;
    /**
     * Indicates whether the recurring task is currently executing, as opposed to being
     * in between executions.
     *
     * @returns `true` if the task is currently executing; otherwise, `false`.
     */
    get isCurrentlyExecuting(): boolean;
    /**
     * Initiates the scheduling of recurring tasks.
     *
     * ### Idempotency
     * This method is idempotent: calling it multiple times while the instance is already
     * active will not alter its state or trigger additional scheduling. It only activates
     * the task if the instance is not already active.
     *
     * ### Border Case: Invocation During a 'terminating' Status
     * If called while the instance is in a 'terminating' status (a rare scenario), this method
     * will first await a status change before determining whether the instance is active.
     *
     * ### Concurrency Considerations
     * The instance can transition between active and inactive states through successive calls to
     * `start` and `stop`, where each `start`-`stop` pair defines a **session**.
     * In **rare cases**, one task may stop an active instance while another concurrently attempts
     * to restart it, even as the final execution from the previous session is still ongoing.
     * While most real-world use cases involve a single session throughout the application's lifecycle,
     * this scenario is accounted for to ensure robustness.
     *
     * @returns `true` if recurring executions were scheduled (i.e., the instance's status changed
     *          from inactive to active);
     *          `false` if the instance was already active and the invocation had no effect.
     */
    start(): Promise<boolean>;
    /**
     * Resolves when the current execution completes, whether it resolves or rejects,
     * if called during an ongoing execution. If no execution is in progress, it resolves
     * immediately.
     *
     * ### Never Rejects
     * This method **never rejects** or throws, even if a currently ongoing execution
     * encounters an error.
     *
     * @returns A promise that resolves when the current execution completes. If called during
     *          an ongoing execution, it resolves once the execution finishes. If no execution
     *          is in progress, it resolves immediately.
     */
    waitUntilCurrentExecutionCompletes(): Promise<void>;
    /**
     * Stops the scheduling of recurring tasks.
     *
     * ### Graceful Teardown
     * If this method is invoked during an ongoing execution, it resolves only after the
     * current execution completes. This guarantee ensures **determinism** and allows for
     * a **graceful teardown**. If the `shouldExecuteFinalRun` flag is enabled, the method
     * also waits for the final (digest) run to complete.
     * Use cases where it is essential to complete any ongoing execution before proceeding include:
     * - **Application Shutdowns**: In cases like `onModuleDestroy` in NestJS applications, where
     *   tasks should complete before termination. For instance, ensuring a bulk-write to a database
     *   is finished instead of abruptly terminating the operation by forcefully exiting the application.
     * - **Unit Tests**: Ensuring a clean state is maintained between tests, preventing ongoing tasks
     *   from interfering with subsequent tests.
     *
     * ### Idempotency
     * This method is **idempotent**: calling it multiple times while the instance is already inactive
     * will not alter its state. It only deactivates task scheduling if the instance is active.
     * In case the instance is in a termination status (i.e., awaiting completion of the last execution),
     * a redundant call will wait for the ongoing execution to complete before resolving.
     *
     * ### Optional: Force an Additional Final Run
     * Enabling the `shouldExecuteFinalRun` flag triggers **one final execution** before resolving.
     * This is particularly useful for tasks that accumulate state between executions and require
     * a final flush (write operation) to **ensure no unprocessed data remains**.
     * #### When This is Relevant
     * - Flushing Batched Writes: A log aggregator that periodically writes accumulated logs to a
     *   database should execute a final flush before stopping to prevent data loss.
     * - Committing Transactions: A system that batches updates should perform one last batch
     *   before stopping to ensure all changes are committed.
     * #### When This is Less Relevant
     * - Periodic Data Fetches: If the task refreshes external configurations at regular intervals,
     *   such as feature flags, an additional fetch before stopping provides no meaningful benefit.
     *
     * @param shouldExecuteFinalRun - If `true`, ensures that one final execution occurs as part of the
     *                                stop process. This is particularly useful for tasks that **accumulate
     *                                state between executions** and require a final flush to avoid leaving
     *                                unprocessed data. To eliminate any ambiguity, when this flag is enabled,
     *                                the `stop` method resolves only **after** the final execution completes.
     * @returns `true` if recurring executions were stopped by this invocation (i.e., the instance's
     *          status changed from 'active' to 'inactive');
     *          `false` if the instance was already inactive or in termination status, and the
     *          invocation had no effect. Note that even when `false` is returned, the call
     *          still waits for the last run to complete if invoked while the instance is in a
     *          'terminating' status.
     */
    stop(shouldExecuteFinalRun?: boolean): Promise<boolean>;
    /**
     * Executes the task in a controlled manner:
     * - Triggers the optional error handler (if provided) when the task rejects with an error.
     * - After execution, regardless of its outcome (resolved or rejected), updates the internal
     *   state of the instance to indicate that no execution is currently in progress.
     *   This is crucial to ensure subsequent execution attempts can succeed.
     */
    private _executeTaskAndUpdateState;
    private _validateOptions;
}
