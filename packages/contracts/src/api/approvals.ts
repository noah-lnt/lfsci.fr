import { z } from "zod";
import { Approval, CreateApprovalInput } from "../approvals";
import { byId, listInput, paginated } from "../entities";
import { ApprovalDecision } from "../enums";
import { Uuid } from "../primitives";

/** POST /v1/approvals — 409 if the proposal changed (the payload hash no longer matches). */
export const createApproval = { input: CreateApprovalInput, output: Approval };
export const getApproval = { input: byId, output: Approval };
export const listApprovals = {
  input: listInput({ commandId: Uuid.optional(), decision: ApprovalDecision.optional() }),
  output: paginated(Approval),
};
export const revokeApproval = {
  input: z.strictObject({ id: Uuid, reason: z.string().min(1) }),
  output: Approval,
};
