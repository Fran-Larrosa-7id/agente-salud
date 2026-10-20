export class CloudError extends Error {
  constructor(readonly code: string, readonly status = 503, readonly retryable?: boolean) { super(code); }
}
