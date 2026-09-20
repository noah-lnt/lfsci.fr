export type { CapabilityModel, CapabilitySnapshot } from "./capability";
export {
  assertCapability,
  CONNECTOR_METHODS,
  fetchCapabilitySnapshot,
  hasCapabilityField,
  introspectCapabilitySnapshot,
  parseCapabilityModels,
} from "./capability";
export type {
  OdooCallOptions,
  OdooClient,
  OdooClientConfig,
  OdooDoc,
  OdooKwargs,
  OdooTransport,
} from "./client";
export {
  createOdooClient,
  DATABASE_HEADER,
  isTransportError,
  REQUEST_ID_CONTEXT_KEY,
  REQUEST_ID_HEADER,
  shapeExecuteKw,
} from "./client";
export type { Clock } from "./clock";
export { systemClock } from "./clock";
export type { OdooCursor } from "./cursor";
export {
  decodeCursor,
  encodeCursor,
  isAfterCursor,
  OVERLAP_MS,
  overlapFrom,
  parseOdooDateTime,
  toOdooDateTime,
} from "./cursor";
export type { CallContext, MappedFailure, OdooFault } from "./errors";
export {
  faultText,
  isAuthFault,
  isPeriodLocked,
  mapHttpFailure,
  mapNetworkFailure,
  mapRpcFault,
  mapTimeoutFailure,
  parseFault,
} from "./errors";
export type { ExchangeRecord, ExchangeRecorder } from "./exchange";
export { createMemoryRecorder, noopRecorder, redactExchange } from "./exchange";
export type {
  AttachDocumentInput,
  CreateCustomerInvoiceInput,
  CreateSupplierBillInput,
  Many2one,
  OdooAccountMove,
  OdooBankStatementLine,
  OdooJournal,
  OdooOperations,
  OdooOperationsOptions,
  OdooPage,
  OdooPartner,
  OperationRefMatch,
  ProposeReconciliationInput,
  SupplierBillLine,
} from "./operations";
export {
  createOdooOperations,
  DEFAULT_OPERATION_REF_FIELD,
  many2oneId,
  newOperationRef,
  OPERATION_REF_PREFIX,
} from "./operations";
export type { RetryOptions, RetryPolicy } from "./retry";
export { backoffDelayMs, defaultRetryPolicy, withRetry } from "./retry";
