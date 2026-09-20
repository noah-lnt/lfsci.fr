import { z } from "zod";
import {
  DepositAccountStatus,
  DepositMovementKind,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  RentReceiptDeliveryChannel,
  RentReceiptKind,
  RentReceiptStatus,
} from "../enums";
import { Audited, Currency, IsoDate, IsoDateTime, Money, Uuid } from "../primitives";

export const PaymentAllocation = Audited.extend({
  paymentId: Uuid,
  rentTermId: Uuid.nullable(),
  depositAccountId: Uuid.nullable(),
  amount: Money,
  currency: Currency,
  allocatedOn: IsoDate,
  confirmedByOdoo: z.boolean(),
  odooReconcileRef: z.string().nullable(),
  odooReadAt: IsoDateTime.nullable(),
  reversedAt: IsoDateTime.nullable(),
  reversalReason: z.string().nullable(),
});
export type PaymentAllocation = z.infer<typeof PaymentAllocation>;

export const Payment = Audited.extend({
  legalEntityId: Uuid,
  direction: PaymentDirection,
  amount: Money,
  currency: Currency,
  receivedOn: IsoDate,
  valueOn: IsoDate.nullable(),
  method: PaymentMethod.nullable(),
  payerPersonId: Uuid.nullable(),
  payerLabel: z.string().nullable(),
  bankTransactionId: Uuid.nullable(),
  status: PaymentStatus,
  odooReadAt: IsoDateTime.nullable(),
  allocations: z.array(PaymentAllocation),
});
export type Payment = z.infer<typeof Payment>;

export const DepositMovement = Audited.extend({
  depositAccountId: Uuid,
  kind: DepositMovementKind,
  amount: Money,
  currency: Currency,
  occurredOn: IsoDate,
  paymentId: Uuid.nullable(),
  offsetRentTermId: Uuid.nullable(),
  justificationDocumentId: Uuid.nullable(),
  approvalId: Uuid.nullable(),
});
export type DepositMovement = z.infer<typeof DepositMovement>;

export const DepositAccount = Audited.extend({
  leaseId: Uuid,
  contractualAmount: Money,
  currency: Currency,
  restitutionDueOn: IsoDate.nullable(),
  status: DepositAccountStatus,
  balanceAmount: Money,
  movements: z.array(DepositMovement),
});
export type DepositAccount = z.infer<typeof DepositAccount>;

export const RentReceipt = Audited.extend({
  leaseId: Uuid,
  kind: RentReceiptKind,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  rentAmount: Money,
  chargeAmount: Money,
  totalAmount: Money,
  currency: Currency,
  issuedOn: IsoDate,
  documentId: Uuid.nullable(),
  deliveryChannel: RentReceiptDeliveryChannel.nullable(),
  status: RentReceiptStatus,
  flaggedReason: z.string().nullable(),
});
export type RentReceipt = z.infer<typeof RentReceipt>;
