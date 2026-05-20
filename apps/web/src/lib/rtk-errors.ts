import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { SerializedError } from '@reduxjs/toolkit';

/**
 * Extracts a human-readable error message from an RTK Query error.
 */
export function getErrorMessage(error: FetchBaseQueryError | SerializedError): string {
  if ('status' in error) {
    // FetchBaseQueryError
    if (typeof error.data === 'string') return error.data;
    if (error.data && typeof error.data === 'object' && 'message' in (error.data as Record<string, unknown>)) {
      return (error.data as Record<string, unknown>).message as string;
    }
    if (error.status === 'CUSTOM_ERROR' && error.error) {
      return error.error;
    }
    return `Request failed (${error.status})`;
  }
  // SerializedError
  return error.message ?? 'Unknown error';
}
