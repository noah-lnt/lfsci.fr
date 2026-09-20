import { z } from "zod";
import {
  byId,
  CreateLeaseInput,
  DepositAccount,
  Lease,
  listInput,
  Payment,
  paginated,
  RentReceipt,
  RentTerm,
  UpdateLeaseInput,
} from "../entities";
import { LeaseKind, LeaseStatus, PaymentStatus, RentTermKind, RentTermStatus } from "../enums";
import { IsoDate, Money, Uuid, Version } from "../primitives";

export const listLeases = {
  input: listInput({
    legalEntityId: Uuid.optional(),
    unitId: Uuid.optional(),
    kind: LeaseKind.optional(),
    status: LeaseStatus.optional(),
    search: z.string().optional(),
  }),
  output: paginated(Lease),
};
export const getLease = { input: byId, output: Lease };
export const createLease = { input: CreateLeaseInput, output: Lease };
export const updateLease = { input: UpdateLeaseInput, output: Lease };

export const listRentTerms = {
  input: listInput({
    leaseId: Uuid.optional(),
    kind: RentTermKind.optional(),
    status: RentTermStatus.optional(),
    dueFrom: IsoDate.optional(),
    dueTo: IsoDate.optional(),
    unsettledOnly: z.boolean().optional(),
  }),
  output: paginated(RentTerm),
};
export const getRentTerm = { input: byId, output: RentTerm };

export const listPayments = {
  input: listInput({
    legalEntityId: Uuid.optional(),
    leaseId: Uuid.optional(),
    status: PaymentStatus.optional(),
    receivedFrom: IsoDate.optional(),
    receivedTo: IsoDate.optional(),
  }),
  output: paginated(Payment),
};
export const getPayment = { input: byId, output: Payment };

/** LOY-02: an allocation is explicit; nothing settles the oldest debt on its own. */
export const allocatePayment = {
  input: z.strictObject({
    paymentId: Uuid,
    expectedVersion: Version,
    allocations: z
      .array(
        z.strictObject({
          rentTermId: Uuid.optional(),
          depositAccountId: Uuid.optional(),
          amount: Money,
          allocatedOn: IsoDate,
        }),
      )
      .min(1),
  }),
  output: Payment,
};

export const getDepositAccount = { input: byId, output: DepositAccount };

export const listReceipts = {
  input: listInput({ leaseId: Uuid.optional(), issuedFrom: IsoDate.optional() }),
  output: paginated(RentReceipt),
};
