import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';

type QueryReturnOk<T> = { data: T };
type QueryReturnErr = { error: FetchBaseQueryError };

/**
 * Wraps a Promise-returning function for use as an RTK Query queryFn.
 * Converts thrown errors to RTK Query's error format.
 */
export async function queryFnResult<T>(fn: () => Promise<T>): Promise<QueryReturnOk<T> | QueryReturnErr> {
  try {
    const data = await fn();
    return { data };
  } catch (err: unknown) {
    return {
      error: {
        status: 'CUSTOM_ERROR',
        error: err instanceof Error ? err.message : 'Unknown error',
      } as FetchBaseQueryError,
    };
  }
}

/**
 * Same as queryFnResult but preserves the HTTP status from errors.
 */
export async function queryFnResultDetailed<T>(fn: () => Promise<T>): Promise<QueryReturnOk<T> | QueryReturnErr> {
  try {
    const data = await fn();
    return { data };
  } catch (err: unknown) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: number }).status
        : undefined;
    if (typeof status === 'number') {
      return {
        error: {
          status,
          data: err instanceof Error ? { message: err.message } : undefined,
        } as FetchBaseQueryError,
      };
    }
    return {
      error: {
        status: 'CUSTOM_ERROR',
        error: err instanceof Error ? err.message : 'Unknown error',
      } as FetchBaseQueryError,
    };
  }
}
