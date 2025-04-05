<h2 align="middle">non-overlapping-recurring-task</h2>

The `NonOverlappingRecurringTask` class provides a modern `setInterval` substitute tailored for asynchronous tasks, ensuring non-overlapping executions by **skipping** attempts if a previous execution is still in progress.

Special emphasis is given to **graceful teardown**: The ability to await the completion of an ongoing execution - particularly during application shutdown - makes it ideal for production environments requiring seamless resource cleanup.

## Table of Contents

* [Key Features](#key-features)
* [API](#api)
* [Getter Methods](#getter-methods)
* [Use Case Example: Batch Upsert for MongoDB Documents](#use-case-example)
* [Non-Overlapping Executions](#non-overlapping-executions)
* [Graceful and Deterministic Teardown](#graceful-teardown)
* [Fixed Delay Between Executions](#fixed-delay-between-executions)
* [Zero Runtime Dependencies](#zero-runtime-dependencies)
* [Concurrency Testing in Unit Tests](#unit-tests)
* [License](#license)

## Key Features :sparkles:<a id="key-features"></a>

* __Guaranteed Non-Overlapping Executions :lock:__: Prevents race conditions ([Race Conditions: How Are They Possible in Single-Threaded JavaScript?](https://www.npmjs.com/package/zero-overhead-promise-lock#race-conditions)) and provides precise control over resource usage. Ideal for batch processing tasks that must run exclusively to manage network bandwidth efficiently.
* __Graceful and Deterministic Teardown :hourglass_flowing_sand:__: When the `stop` method is invoked during task execution, it resolves only **after** the execution is complete. This guarantees **smooth resource cleanup**, making it well-suited for production environments (e.g., `onModuleDestroy` in NestJS) and maintaining a **clean state** between unit tests.
* __Fixed Delay Between Executions :repeat:__: Functions similarly to JavaScript's built-in `setInterval`, but skips executions if a previous one is still in progress.
- __Flexible First Execution Policy :level_slider:__: The `immediateFirstRun` option lets you control whether execution begins immediately upon `start` or only after the first interval. Particularly useful when the task is part of an **application’s bootstrap phase** (e.g., `onModuleInit` in NestJS). If the bootstrap phase requires the first execution to complete before proceeding (e.g., before accepting HTTP requests), pair this with `waitUntilCurrentExecutionCompletes`.
- __Optional Final Digest Run :broom:__: The optional `shouldExecuteFinalRun` flag allows a final execution to be performed as part of the `stop` process. This is especially useful for tasks that accumulate state between executions and need a final flush to persistent storage to avoid leaving unprocessed data. Examples include delayed publishing of batched Kafka messages and upserting accumulated data into a database.
- __Error Handling :warning:__: If a periodic task throws an error, it is passed to an optional error handler callback, if provided. This component does **not** perform any logging, as it is designed to be **agnostic of user preferences**, such as specific loggers or logging styles. A typical `_onTaskError` implementation logs errors based on the user's logging strategy. If the periodic task already handles its own errors, this handler can be omitted.
- __Execution State Metrics :bar_chart:__: The `status` and `isCurrentlyExecuting` getters offer real-time insights into the scheduler's state, helping users make informed decisions, such as awaiting `waitUntilCurrentExecutionCompletes` when specific operations must not overlap the recurring task.
- __Comprehensive documentation :books:__: Fully documented, enabling IDEs to provide intelligent **tooltips** for an enhanced development experience.
- __Thoroughly Tested :test_tube:__: Backed by extensive unit tests, covering even rare edge cases, to ensure reliability in production.
- __Zero Runtime Dependencies :dove:__: Only development dependencies are included.
- __ES2020 Compatibility__: The project targets ES2020 for modern JavaScript support.
- __Full TypeScript Support__: Designed for seamless TypeScript integration.

## API :globe_with_meridians:<a id="api"></a>

The `NonOverlappingRecurringTask` class provides the following methods:

* __start__: Initiates the scheduling of recurring tasks. This method is **idempotent**: calling it multiple times while the instance is already active will not alter its state or trigger additional scheduling. It only activates the task if the instance is not already active.
* __stop__: Stops the scheduling of recurring tasks. If this method is invoked during an ongoing execution, it resolves **only after** the current execution completes. This guarantee ensures determinism and allows for a graceful teardown.
* __waitUntilCurrentExecutionCompletes__: Resolves when the current execution completes, whether it resolves or rejects, if called during an ongoing execution. If no execution is in progress, it resolves immediately. This method **never throws**, even if a currently ongoing execution encounters an error.

If needed, refer to the code documentation for a more comprehensive description of each method.

## Getter Methods :mag:<a id="getter-methods"></a>

The `NonOverlappingRecurringTask` class provides the following getter methods to reflect the current activity state:

* __status__: Returns the current instance status, which can be one of the following:
    * `active`: Currently managing recurring executions.
    * `inactive`: Not managing any recurring executions.
    * `terminating`: A stop attempt was made, but the last execution from the previous session is still ongoing.
* __isCurrentlyExecuting__: Indicates whether the recurring task is currently executing, as opposed to being in between executions.

## Use Case Example: Batch Upsert for MongoDB Documents :package:<a id="use-case-example"></a>

In many applications, MongoDB documents originate from sources such as message queues or user interactions. Instead of upserting each document individually - potentially causing excessive network load - it is common to **accumulate** them in memory before performing a periodic batch flush to the database.

The **non-overlapping execution guarantee** ensures that multiple batches are never upserted concurrently, helping to keep network bandwidth usage under control. This guarantee allows users to set a relatively low interval while focusing on their business logic without worrying about overlapping operations.

This example leverages the [batched-items-accumulator](https://www.npmjs.com/package/batched-items-accumulator) package to accumulate documents into fixed-size batches (number-of-documents wise). It abstracts batch management, allowing users to focus on application logic:
```ts
import {
  NonOverlappingRecurringTask,
  INonOverlappingRecurringTaskOptions
} from 'non-overlapping-recurring-task';
import { BatchedAccumulator } from 'batched-items-accumulator';
import { Collection } from 'mongodb';

const FLUSH_INTERVAL_MS = 5000;
const BATCH_SIZE = 512;

class PeriodicDocumentFlusher<DocumentType> {
  private readonly _documentsAccumulator = new BatchedAccumulator<DocumentType>(BATCH_SIZE);
  private readonly _recurringFlush: NonOverlappingRecurringTask<MongoError>;

  /**
   * Injects a collection and a logger instance.  
   * Context-aware child loggers are commonly used,  
   * especially in Nest.js apps (e.g., pino-http). 
   */
  constructor(
    private readonly _collection: Collection<DocumentType>,
    private readonly _logger: ILogger
  ) {
    const recurringFlushOptions: INonOverlappingRecurringTaskOptions = {
      intervalMs: FLUSH_INTERVAL_MS,
      immediateFirstRun: false
    };
    this._recurringFlush = new NonOverlappingRecurringTask<MongoError>(
      () => this._flushAccumulatedBatches(),
      recurringFlushOptions,
      this._onUpsertError.bind(this)
    );
  }

  public async start(): Promise<void> {
    await this._recurringFlush.start();
  }
  
  public async stop(): Promise<void> {
    await this._recurringFlush.stop();
    await this._flushAccumulatedBatches();
  }

  public add(doc: DocumentType): void {
    // Accumulate documents in memory for batch processing.
    this._documentsAccumulator.accumulateItem(doc);
  }

  private async _bulkUpsert(batch: DocumentType[]): Promise<void> {
    // Implementation: Upsert a batch of accumulated documents into MongoDB.
  }

  /**
   * Extracts accumulated document batches and upserts them sequentially.  
   * A production-ready implementation may include per-batch error handling,  
   * retries, or an early exit if the accumulated document count is below  
   * a certain threshold.  
   *  
   * For brevity, this example focuses solely on the upsert process.
   */
  private async _flushAccumulatedBatches(): Promise<void> {
    const batches: DocumentType[][] = this._documentsAccumulator.extractAccumulatedBatches();
    for (const batch of batches) {
      await this._bulkUpsert(batch);
    }
  }

  private _onUpsertError(error: MongoError): void {
    this._logger.error(
      `Batch upload failed due to MongoDB error code ${error?.code}: ${error.message}`
    );
  }
}
```

## Non-Overlapping Executions :lock:<a id="non-overlapping-executions"></a>

In many cases, recurring tasks are assumed to never overlap due to a sufficiently long interval. As a result, the task's business logic may not account for overlapping executions. By **eliminating this possibility at the scheduler level**, the task can focus solely on its intended logic without the need for additional safeguards, such as [zero-overhead-promise-lock](https://www.npmjs.com/package/zero-overhead-promise-lock).

This built-in guarantee reinforces **Separation of Concerns** and the **Single Responsibility Principle**, enhancing overall robustness.

## Graceful and Deterministic Teardown :hourglass_flowing_sand:<a id="graceful-teardown"></a>

Task execution promises are tracked by the instance, ensuring no dangling promises. This enables a graceful teardown via the `stop` method, in scenarios where it is essential to **ensure that any ongoing execution is completed before proceeding**.

Examples include:
* Application shutdowns (e.g., `onModuleDestroy` in NestJS applications) where tasks should complete before termination. For instance, ensuring a bulk-write to a database is finished instead of abruptly terminating the operation by forcefully exiting the application.
* Unit tests, where a clean state is essential to prevent ongoing tasks from interfering with subsequent tests.

## Fixed Delay Between Executions :repeat:<a id="fixed-delay-between-executions"></a>

Like JavaScript’s built-in `setInterval`, this scheduler ensures a **fixed interval between execution start times**. That is, for an absolute timestamp T, execution start times follow the formula `T + i * intervalMs` where i is a non-negative integer.

However, there are two key differences:
* Immediate First Run (`immediateFirstRun` flag): When enabled, the first execution occurs immediately after invoking `start`. In contrast, `setInterval` waits for the first interval before executing.
* Non-Overlapping Guarantee: If an execution **exceeds** the interval duration, subsequent executions are **skipped** until the ongoing execution completes.

#### Example
* Suppose `T` is the timestamp when `start` is invoked, the interval is 100ms, and `immediateFirstRun` is enabled.
* The first execution starts immediately and runs for **350ms**.
* Since start times adhere to the formula `T + 100 * i`, the scheduler **skips** cycles where i = 1,2,3.
* The next execution begins at `T + 400ms`.

## Zero Runtime Dependencies :dove:<a id="zero-runtime-dependencies"></a>

Many custom solutions or third-party libraries introduce **runtime dependencies**, increasing project size and complexity. This class provides a **lightweight, dependency-free solution** while ensuring predictable execution. Additionally, it can serve as a foundation for more advanced implementations if needed.

## Concurrency Testing in Unit Tests :test_tube:<a id="unit-tests"></a>

While ideal tests follow a strict Arrange-Act-Assert structure, rigorously testing concurrency-oriented components often requires validating **intermediate states**. Incorrect intermediate states can compromise the entire component's correctness, making their verification essential.

As with everything in engineering, this comes at a cost: verbosity. Given that resilience is the primary goal, this is a small price to pay.

## License :scroll:<a id="license"></a>

[Apache 2.0](LICENSE)
