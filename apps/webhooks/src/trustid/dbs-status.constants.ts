// ---------------------------------------------------------------------------
// DBS (Disclosure and Barring Service) Status Codes
//
// These are the status codes that TrustID Cloud reports for DBS check
// applications. Each code maps to a TrustID interpretation that describes
// what the status means at a higher level.
// ---------------------------------------------------------------------------

export const DBSStatus = {
  /** Submitted by applicant, ready for processing */
  FORM_READY: 'FORM_READY',
  /** Ready for RB to countersign */
  FORM_COMPLETE: 'FORM_COMPLETE',
  /** Countersigned, ready for sending to checking authority (e.g. DBS) */
  FORM_AUTHORISED: 'FORM_AUTHORISED',
  /** Sent to checking authority (e.g. DBS) */
  APP_SENT: 'APP_SENT',
  /** Invalid, was not sent to checking authority (e.g. DBS) */
  FORM_INVALID: 'FORM_INVALID',
  /** Received (receipted) by checking authority (e.g. DBS) */
  APP_RECEIVED: 'APP_RECEIVED',
  /** Rejected by checking authority (e.g. DBS) due to errors */
  APP_REJECTED: 'APP_REJECTED',
  /** Completed by checking authority (e.g. DBS), result is available */
  APP_COMPLETE: 'APP_COMPLETE',
  /** Withdrawn from eBulkPlus */
  APP_WITHDRAWN: 'APP_WITHDRAWN',
  /** Awaiting Digital ID Result */
  AWAITING_DIGITAL_ID: 'AWAITING_DIGITAL_ID',
} as const;

export type DBSStatusCode = (typeof DBSStatus)[keyof typeof DBSStatus];

/**
 * DBS status code → TrustID interpretation mapping.
 *
 * Maps each raw DBS status code to the interpretation string that TrustID
 * provides in their documentation. These interpretations are the "plain
 * English" summaries suitable for display to end users.
 */
export const DBS_STATUS_INTERPRETATION: Record<DBSStatusCode, string> = {
  [DBSStatus.FORM_READY]: 'DBS Check Initiated',
  [DBSStatus.FORM_COMPLETE]: 'DBS Check In Progress',
  [DBSStatus.FORM_AUTHORISED]: 'DBS Check In Progress',
  [DBSStatus.APP_SENT]: 'DBS Check In Progress',
  [DBSStatus.FORM_INVALID]: 'DBS Check In Progress',
  [DBSStatus.APP_RECEIVED]: 'DBS Check In Progress',
  [DBSStatus.APP_REJECTED]: 'DBS Check Rejected',
  [DBSStatus.APP_COMPLETE]: 'DBS Check Complete',
  [DBSStatus.APP_WITHDRAWN]: 'DBS Check Withdrawn',
  [DBSStatus.AWAITING_DIGITAL_ID]: 'DBS Check In Progress',
};

/**
 * Map DBS status codes to our trust token statuses.
 *
 * This provides a mapping from raw DBS status to the internal token
 * status that controls the guest-facing UX.
 */
export const DBS_STATUS_TO_TOKEN_STATUS: Record<DBSStatusCode, string> = {
  [DBSStatus.FORM_READY]: 'submitted',
  [DBSStatus.FORM_COMPLETE]: 'submitted',
  [DBSStatus.FORM_AUTHORISED]: 'submitted',
  [DBSStatus.APP_SENT]: 'submitted',
  [DBSStatus.FORM_INVALID]: 'submitted',
  [DBSStatus.APP_RECEIVED]: 'submitted',
  [DBSStatus.APP_REJECTED]: 'denied',
  [DBSStatus.APP_COMPLETE]: 'approved',
  [DBSStatus.APP_WITHDRAWN]: 'denied',
  [DBSStatus.AWAITING_DIGITAL_ID]: 'submitted',
};

/**
 * Check whether a DBS status code indicates the check is still in-progress
 * (i.e., not yet at a terminal state).
 */
export function isDBSInProgress(code: string | null | undefined): boolean {
  if (!code) return true; // Unknown = assume in-progress
  const interpretation = DBS_STATUS_INTERPRETATION[code as DBSStatusCode];
  return interpretation === 'DBS Check Initiated' || interpretation === 'DBS Check In Progress';
}

/**
 * Check whether a DBS status code indicates the check is complete
 * (terminal state — either approved or rejected/withdrawn).
 */
export function isDBSTerminal(code: string | null | undefined): boolean {
  if (!code) return false;
  return !isDBSInProgress(code);
}

/**
 * Get the human-readable interpretation for a raw DBS status code.
 * Returns the raw code if no interpretation is available.
 */
export function interpretDBSStatus(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  return DBS_STATUS_INTERPRETATION[code as DBSStatusCode] ?? code;
}
