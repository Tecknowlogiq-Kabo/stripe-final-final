import type { DataSource, QueryRunner } from 'typeorm';

/**
 * Executes `fn` inside a single Oracle transaction.
 * Commits on success, rolls back on error, always releases the runner.
 */
export async function withTransaction<T>(
  dataSource: DataSource,
  fn: (runner: QueryRunner) => Promise<T>,
): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const result = await fn(runner);
    await runner.commitTransaction();
    return result;
  } catch (err) {
    await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
  }
}
