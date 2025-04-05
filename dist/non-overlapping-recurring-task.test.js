"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * General note on testing concurrency in unit tests:
 * While ideal tests follow a strict Arrange-Act-Assert structure, rigorously testing
 * concurrency-oriented components often requires validating *intermediate states*.
 * Incorrect intermediate states can compromise the entire component's correctness,
 * making their verification essential.
 *
 * As with everything in engineering, this comes at a cost: verbosity.
 * Given that resilience is the primary goal, this is a small price to pay.
 */
const non_overlapping_recurring_task_1 = require("./non-overlapping-recurring-task");
const createError = (taskID) => ({
    name: 'CustomTaskError',
    message: `Task no. ${taskID} has failed`,
    taskID,
});
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS = 6000;
/**
 * Tests the case where the task duration never exceeds the interval,
 * ensuring that no executions are skipped.
 *
 * If taskSucceeds=false, no custom error handler is provided,
 * simulating a real-world scenario where error handling is done within the task itself.
 *
 * @param taskSucceeds Indicates whether the task promise should resolve or reject.
 */
async function noSkippedExecutionsTest(taskSucceeds) {
    // Arrange.
    const options = {
        intervalMs: MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS,
        immediateFirstRun: false,
    };
    // Ensure executions complete before the next interval starts.
    const taskDurationMs = Math.floor((3 * MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS) / 4);
    let completedExecutions = 0;
    const task = async () => {
        await sleep(taskDurationMs);
        ++completedExecutions;
        if (!taskSucceeds) {
            throw createError(completedExecutions);
        }
    };
    const recurringTask = new non_overlapping_recurring_task_1.NonOverlappingRecurringTask(task, options);
    const totalExecutionsCount = 18;
    const timeStepMs = 200; // Check intermediate state at each step.
    const stepsPerInterval = -1 + Math.floor(MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS / timeStepMs);
    const advanceTimeStep = async () => {
        await jest.advanceTimersByTimeAsync(timeStepMs);
        elapsedTimeMs += timeStepMs;
    };
    // Act & Assert intermediate states.
    expect(recurringTask.status).toBe('inactive');
    const didStart = await recurringTask.start();
    expect(didStart).toBe(true);
    expect(recurringTask.status).toBe('active');
    expect(recurringTask.isCurrentlyExecuting).toBe(false); // Because immediateFirstRun: false
    let elapsedTimeMs = 0;
    for (let cycle = 0; cycle < totalExecutionsCount; ++cycle) {
        for (let step = 0; step < stepsPerInterval; ++step) {
            await advanceTimeStep();
            expect(recurringTask.status).toBe('active');
            if (cycle === 0) {
                // The first execution is intentionally skipped due to `immediateFirstRun: false`.
                expect(recurringTask.isCurrentlyExecuting).toBe(false);
                expect(completedExecutions).toBe(0);
                continue;
            }
            // Determine if the execution is ongoing or has completed.
            const isExecutionOngoing = elapsedTimeMs % MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS < taskDurationMs;
            expect(recurringTask.isCurrentlyExecuting).toBe(isExecutionOngoing);
            expect(completedExecutions).toBe(isExecutionOngoing ? cycle - 1 : cycle);
        }
        // Advance to the next cycle.
        await advanceTimeStep();
    }
    // Stop the task and ensure final state.
    let stopResultPromise = recurringTask.stop();
    await jest.advanceTimersByTimeAsync(0);
    expect(recurringTask.status).toBe('terminating');
    await Promise.all([stopResultPromise, jest.advanceTimersByTimeAsync(taskDurationMs)]);
    expect(await stopResultPromise).toBe(true);
    expect(recurringTask.status).toBe('inactive');
    expect(recurringTask.isCurrentlyExecuting).toBe(false);
    expect(completedExecutions).toBe(totalExecutionsCount);
}
/**
 * Tests the scenario where the task duration always exceeds the interval,
 * ensuring that some executions are skipped. This validates the guarantee
 * that an execution is skipped if the previous one is still running.
 *
 * If taskSucceeds=false, a custom error handler is provided, simulating
 * real-world error handling. The primary goal in this case is to validate
 * the thrown error.
 *
 * @param taskSucceeds Indicates whether the task promise should resolve or reject.
 */
async function skippedExecutionsTest(taskSucceeds) {
    // Arrange.
    const options = {
        intervalMs: MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS,
        immediateFirstRun: true,
    };
    // Ensure executions complete **after** the next interval starts.
    const taskDurationIntervalRatio = 3.2;
    const taskDurationMs = taskDurationIntervalRatio * MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS;
    let completedExecutions = 0;
    let elapsedTimeMs = 0; // Track elapsed time.
    let lastError;
    const task = async () => {
        await sleep(taskDurationMs);
        ++completedExecutions;
        if (!taskSucceeds) {
            lastError = createError(completedExecutions);
            throw lastError;
        }
    };
    const onTaskErrorSpy = jest.fn();
    const recurringTask = new non_overlapping_recurring_task_1.NonOverlappingRecurringTask(task, options, onTaskErrorSpy);
    const totalExecutionsCount = 12;
    const timeStepMs = 200; // Check intermediate state at each step.
    // Number of intervals required for one execution to complete.
    // Since taskDurationMs is 3.2 times the interval, each execution spans 4 intervals.
    const requiredIntervalsPerExecution = Math.ceil(taskDurationIntervalRatio);
    const executionCycleDurationMs = requiredIntervalsPerExecution * MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS;
    const stepsPerCycle = Math.floor(executionCycleDurationMs / timeStepMs) - 1;
    const advanceTimeStep = async () => {
        await jest.advanceTimersByTimeAsync(timeStepMs);
        elapsedTimeMs += timeStepMs;
    };
    const isWithinExecutionWindow = () => elapsedTimeMs % executionCycleDurationMs < taskDurationMs;
    const validateErrorHandlerSpy = () => {
        expect(onTaskErrorSpy).toHaveBeenCalledTimes(taskSucceeds ? 0 : completedExecutions);
        if (taskSucceeds) {
            expect(lastError).toBeUndefined();
            expect(onTaskErrorSpy).not.toHaveBeenCalled();
            return;
        }
        const expectedLastError = completedExecutions > 0 ? createError(completedExecutions) : undefined;
        expect(lastError).toEqual(expectedLastError);
        if (completedExecutions > 0) {
            expect(onTaskErrorSpy).toHaveBeenLastCalledWith(lastError);
        }
    };
    // Act & Assert intermediate states.
    expect(recurringTask.status).toBe('inactive');
    const didStart = await recurringTask.start();
    expect(didStart).toBe(true);
    expect(recurringTask.status).toBe('active');
    expect(recurringTask.isCurrentlyExecuting).toBe(true); // Because immediateFirstRun: true
    for (let cycle = 1; cycle < totalExecutionsCount; ++cycle) {
        for (let step = 0; step < stepsPerCycle; ++step) {
            await advanceTimeStep();
            expect(recurringTask.status).toBe('active');
            const shouldCurrentlyExecute = isWithinExecutionWindow();
            expect(recurringTask.isCurrentlyExecuting).toBe(shouldCurrentlyExecute);
            expect(completedExecutions).toBe(shouldCurrentlyExecute ? cycle - 1 : cycle);
            validateErrorHandlerSpy();
        }
        // Advance to the next cycle.
        await advanceTimeStep();
    }
    // Stop the task and ensure final state.
    let stopResultPromise = recurringTask.stop();
    await jest.advanceTimersByTimeAsync(0);
    expect(recurringTask.status).toBe('terminating');
    await Promise.all([stopResultPromise, jest.advanceTimersByTimeAsync(taskDurationMs)]);
    expect(await stopResultPromise).toBe(true);
    expect(recurringTask.status).toBe('inactive');
    expect(recurringTask.isCurrentlyExecuting).toBe(false);
    expect(completedExecutions).toBe(totalExecutionsCount);
    validateErrorHandlerSpy();
}
async function stopShouldAwaitOngoingExecutionTest() {
    // Arrange.
    const options = {
        intervalMs: MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS,
        immediateFirstRun: true,
    };
    const taskDurationMs = Math.floor((2 * MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS) / 3);
    let completedExecutions = 0;
    const task = async () => {
        await sleep(taskDurationMs);
        ++completedExecutions;
    };
    const recurringTask = new non_overlapping_recurring_task_1.NonOverlappingRecurringTask(task, options);
    const totalExecutionsCount = 15;
    const timeStepMs = 200; // Check intermediate state at each step.
    let elapsedTimeSinceLastStartMs = 0; // Tracks time since the last start.
    const advanceTimeStep = async () => {
        await jest.advanceTimersByTimeAsync(timeStepMs);
        elapsedTimeSinceLastStartMs += timeStepMs;
    };
    // Act & Assert intermediate states.
    for (let cycle = 1; cycle <= totalExecutionsCount; ++cycle) {
        elapsedTimeSinceLastStartMs = 0;
        await recurringTask.start();
        expect(recurringTask.status).toBe('active');
        expect(recurringTask.isCurrentlyExecuting).toBe(true);
        const stopPromise = recurringTask.stop(); // Waits for the ongoing execution to complete.
        // Until the current execution completes, the status is expected to be 'terminating'.
        while (elapsedTimeSinceLastStartMs < taskDurationMs) {
            await advanceTimeStep();
            const shouldCurrentlyExecute = elapsedTimeSinceLastStartMs < taskDurationMs;
            expect(recurringTask.isCurrentlyExecuting).toBe(shouldCurrentlyExecute);
            expect(recurringTask.status).toBe(shouldCurrentlyExecute ? 'terminating' : 'inactive');
            expect(completedExecutions).toBe(shouldCurrentlyExecute ? cycle - 1 : cycle);
        }
        await stopPromise;
        expect(recurringTask.status).toBe('inactive');
        expect(recurringTask.isCurrentlyExecuting).toBe(false);
    }
    expect(completedExecutions).toBe(totalExecutionsCount);
}
async function startShouldWaitForPreviousExecutionTest() {
    // Arrange.
    const options = {
        intervalMs: MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS,
        immediateFirstRun: true,
    };
    const taskDurationMs = Math.floor((5 * MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS) / 8);
    let completedExecutions = 0;
    const task = async () => {
        await sleep(taskDurationMs);
        ++completedExecutions;
    };
    const recurringTask = new non_overlapping_recurring_task_1.NonOverlappingRecurringTask(task, options);
    await recurringTask.start();
    expect(recurringTask.status).toBe('active');
    const stopPromise = recurringTask.stop();
    expect(recurringTask.status).toBe('terminating');
    const pendingStartPromise = recurringTask.start();
    // 'start' waits for the 'terminating' status to resolve before determining if the
    // instance is active.
    expect(recurringTask.status).toBe('terminating');
    const timeStepMs = 100; // Check intermediate state at each step.
    let elapsedTimeMs = 0;
    const advanceTimeStep = async () => {
        await jest.advanceTimersByTimeAsync(timeStepMs);
        elapsedTimeMs += timeStepMs;
    };
    // Act & Assert intermediate states.
    while (elapsedTimeMs < taskDurationMs) {
        expect(recurringTask.isCurrentlyExecuting).toBe(true);
        expect(completedExecutions).toBe(0);
        expect(recurringTask.status).toBe('terminating');
        await advanceTimeStep();
    }
    await Promise.all([stopPromise, pendingStartPromise]);
    expect(recurringTask.isCurrentlyExecuting).toBe(true);
    expect(completedExecutions).toBe(1);
    expect(recurringTask.status).toBe('active');
    await Promise.all([jest.advanceTimersByTimeAsync(taskDurationMs), recurringTask.stop()]);
    expect(completedExecutions).toBe(2);
    expect(recurringTask.status).toBe('inactive');
}
async function startShouldNotAlterStateWhenActiveTest() {
    // Arrange.
    const options = {
        intervalMs: MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS,
        immediateFirstRun: true,
    };
    const taskDurationMs = MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS;
    const task = async () => {
        await sleep(taskDurationMs);
    };
    const recurringTask = new non_overlapping_recurring_task_1.NonOverlappingRecurringTask(task, options);
    // Act & Assert intermediate states.
    expect(await recurringTask.start()).toBe(true);
    expect(recurringTask.status).toBe('active');
    expect(recurringTask.isCurrentlyExecuting).toBe(true);
    const redundantStartAttempts = 20;
    for (let attempt = 1; attempt <= redundantStartAttempts; ++attempt) {
        // This redundant `start` invocation should have no effect, as the instance
        // is already active.
        expect(await recurringTask.start()).toBe(false);
        expect(recurringTask.status).toBe('active');
        expect(recurringTask.isCurrentlyExecuting).toBe(true);
    }
    const stopPromise = recurringTask.stop();
    expect(recurringTask.status).toBe('terminating');
    await jest.advanceTimersByTimeAsync(taskDurationMs);
    await stopPromise;
    expect(recurringTask.status).toBe('inactive');
    expect(recurringTask.isCurrentlyExecuting).toBe(false);
}
async function stopShouldNotAlterStateWhenInactiveTest() {
    // Arrange.
    const options = {
        intervalMs: MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS,
        immediateFirstRun: true,
    };
    const taskDurationMs = MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS;
    const task = async () => {
        await sleep(taskDurationMs);
    };
    const recurringTask = new non_overlapping_recurring_task_1.NonOverlappingRecurringTask(task, options);
    // Act & Assert intermediate states.
    expect(recurringTask.status).toBe('inactive');
    expect(recurringTask.isCurrentlyExecuting).toBe(false);
    const redundantStopAttempts = 14;
    for (let attempt = 1; attempt <= redundantStopAttempts; ++attempt) {
        // This redundant `stop` invocation should have no effect, as the instance
        // is already inactive.
        expect(await recurringTask.stop()).toBe(false);
        expect(recurringTask.status).toBe('inactive');
        expect(recurringTask.isCurrentlyExecuting).toBe(false);
    }
}
async function shouldExecuteFinalRunTest(shouldStopDuringExecution) {
    // Arrange.
    const options = {
        intervalMs: MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS,
        immediateFirstRun: true,
    };
    const taskDurationMs = Math.floor(MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS / 3);
    let completedExecutions = 0;
    const task = jest.fn().mockImplementation(async () => {
        await sleep(taskDurationMs);
        ++completedExecutions;
    });
    const recurringTask = new non_overlapping_recurring_task_1.NonOverlappingRecurringTask(task, options);
    const pollIntervalMs = 200; // Periodically check status, simulating real-time passage.
    // Act & Assert intermediate states.
    await recurringTask.start();
    expect(task).toHaveBeenCalledTimes(1);
    expect(completedExecutions).toBe(0);
    if (shouldStopDuringExecution) {
        const partialExecutionTimeMs = taskDurationMs - pollIntervalMs;
        await jest.advanceTimersByTimeAsync(partialExecutionTimeMs);
        expect(completedExecutions).toBe(0);
    }
    else {
        const postExecutionDelayMs = taskDurationMs + pollIntervalMs;
        await jest.advanceTimersByTimeAsync(postExecutionDelayMs);
        expect(completedExecutions).toBe(1);
    }
    expect(task).toHaveBeenCalledTimes(1);
    expect(recurringTask.status).toBe('active');
    const shouldExecuteFinalRun = true;
    const stopPromise = recurringTask.stop(shouldExecuteFinalRun);
    if (shouldStopDuringExecution) {
        // Let current run finish.
        await jest.advanceTimersByTimeAsync(pollIntervalMs);
        expect(completedExecutions).toBe(1);
    }
    let remainingFinalExecutionTimeMs = taskDurationMs;
    while (remainingFinalExecutionTimeMs > 0) {
        expect(task).toHaveBeenCalledTimes(2);
        expect(completedExecutions).toBe(1);
        expect(recurringTask.status).toBe('terminating');
        await Promise.race([jest.advanceTimersByTimeAsync(pollIntervalMs), stopPromise]);
        remainingFinalExecutionTimeMs -= pollIntervalMs;
    }
    expect(task).toHaveBeenCalledTimes(2);
    expect(completedExecutions).toBe(2);
    expect(recurringTask.status).toBe('inactive');
}
describe('NonOverlappingRecurringTask tests', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });
    describe('Happy path tests', () => {
        test('should not skip executions when each execution duration is less than the interval', async () => {
            const taskSucceeds = true;
            await noSkippedExecutionsTest(taskSucceeds);
        });
        test('should skip executions when each execution duration is more than the interval', async () => {
            const taskSucceeds = true;
            await skippedExecutionsTest(taskSucceeds);
        });
        test('stop should await ongoing execution completion before resolving', async () => {
            await stopShouldAwaitOngoingExecutionTest();
        });
        // prettier-ignore
        test('start method should wait for ongoing execution to complete ' +
            'if called during terminating status', async () => {
            await startShouldWaitForPreviousExecutionTest();
        });
        // prettier-ignore
        test('shouldExecuteFinalRun flag enabled: executes final run when stop() is called ' +
            'during an ongoing execution', async () => {
            const shouldStopDuringExecution = true;
            await shouldExecuteFinalRunTest(shouldStopDuringExecution);
        });
        // prettier-ignore
        test('shouldExecuteFinalRun flag enables: executes final run when stop() is called ' +
            'between executions', async () => {
            const shouldStopDuringExecution = false;
            await shouldExecuteFinalRunTest(shouldStopDuringExecution);
        });
    });
    describe('Negative path tests', () => {
        // prettier-ignore
        test('should continue recurring executions when tasks reject with error: ' +
            'no error handler is provided', async () => {
            const taskSucceeds = false;
            await noSkippedExecutionsTest(taskSucceeds);
        });
        // prettier-ignore
        test('should continue recurring executions when tasks reject with error: ' +
            'error handler is provided', async () => {
            const taskSucceeds = false;
            await skippedExecutionsTest(taskSucceeds);
        });
        test('start method should not alter state if instance is already active', async () => {
            await startShouldNotAlterStateWhenActiveTest();
        });
        test('stop method should not alter state if instance is already inactive', async () => {
            await stopShouldNotAlterStateWhenInactiveTest();
        });
        test('should throw an error when intervalMs is not a natural number', async () => {
            const nonNaturalNumbers = [-14847, -5.0001, -4, -0.02, 0, 0.48, 4.3, 45.001, 600.7];
            for (const invalidInterval of nonNaturalNumbers) {
                // Arrange.
                const options = {
                    intervalMs: invalidInterval,
                    immediateFirstRun: true,
                };
                const task = jest.fn();
                // Act.
                expect(() => new non_overlapping_recurring_task_1.NonOverlappingRecurringTask(task, options)).toThrow();
            }
        });
        test('should throw an error when immediateFirstRun is not a boolean', async () => {
            const nonBooleanValues = [
                -14847,
                -5.0001,
                0,
                1,
                'true',
                [],
                {},
                'false',
                '0',
                null,
                undefined,
            ];
            for (const nonBool of nonBooleanValues) {
                // Arrange.
                const options = {
                    intervalMs: MOCK_INTERVAL_BETWEEN_CONSECUTIVE_STARTS_MS,
                    immediateFirstRun: nonBool,
                };
                const task = jest.fn();
                // Act.
                expect(() => new non_overlapping_recurring_task_1.NonOverlappingRecurringTask(task, options)).toThrow();
            }
        });
    });
});
//# sourceMappingURL=non-overlapping-recurring-task.test.js.map