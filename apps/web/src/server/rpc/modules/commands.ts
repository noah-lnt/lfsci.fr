import "server-only";
import { CommandState } from "@lfsci/contracts";
import { AppError } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ApprovalsPendingResult, CommandDetail, CommandRow } from "@/lib/contracts/commands";
import { auth } from "../../auth";
import { decideApproval, listApprovals } from "../../commands/approvals";
import { submitCommand } from "../../commands/submit";
import { tenant } from "../../data";
import { validated, withOrganization } from "../base";

const CommandListResult = z.object({ items: z.array(CommandRow) });
const DecideResult = z.object({ commandId: z.uuid(), status: CommandState });

type RawCommand = {
  id: string;
  version: number;
  command_type: string;
  operation_key: string;
  payload_hash: string;
  status: string;
  autonomy_level: "A" | "B" | "C" | "D";
  error_type: string | null;
  error_detail: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string | null;
};

const SELECT_COMMAND = sql`
  SELECT c.id, c.version, c.command_type, c.operation_key, c.payload_hash, c.status,
         c.autonomy_level, c.error_type, c.error_detail, c.correlation_id,
         to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS created_at,
         to_char(c.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS updated_at
    FROM command c`;

export function toCommandRow(raw: RawCommand) {
  return {
    id: raw.id,
    version: raw.version,
    commandType: raw.command_type,
    operationKey: raw.operation_key,
    payloadHash: raw.payload_hash,
    status: CommandState.parse(raw.status),
    autonomyLevel: raw.autonomy_level,
    errorType: raw.error_type,
    errorDetail: raw.error_detail,
    correlationId: raw.correlation_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/** IA-03: only the owner-admin decides; anyone else is simply not allowed. */
async function requireOwnerAdmin(headers: Headers): Promise<string> {
  const member = await auth().api.getActiveMember({ headers });
  if (member?.role !== "owner_admin") throw new AppError("FORBIDDEN");
  return member.userId;
}

export const commandsRouter = {
  commands: {
    list: withOrganization.commands.list
      .use(validated(CommandListResult))
      .handler(async ({ context, input }) =>
        tenant(context, async (tx) => {
          const where = [sql`TRUE`];
          if (input.status) where.push(sql`c.status = ${input.status}`);
          if (input.commandType) where.push(sql`c.command_type = ${input.commandType}`);
          const rows = [
            ...(await tx.execute<RawCommand>(
              sql`${SELECT_COMMAND} WHERE ${sql.join(where, sql` AND `)}
                   ORDER BY c.created_at DESC LIMIT ${input.limit}`,
            )),
          ] as RawCommand[];
          return { items: rows.map(toCommandRow) };
        }),
      ),
    get: withOrganization.commands.get
      .use(validated(CommandDetail))
      .handler(async ({ context, input }) =>
        tenant(context, async (tx) => {
          const rows = [
            ...(await tx.execute<RawCommand & { payload: Record<string, unknown> }>(
              sql`${SELECT_COMMAND}, c.payload WHERE c.id = ${input.id}::uuid LIMIT 1`,
            )),
          ];
          const raw = rows[0];
          if (!raw) throw new AppError("NOT_FOUND", { details: { commandId: input.id } });
          const attempts = [
            ...(await tx.execute<{
              id: string;
              attempt_number: number;
              step: string;
              outcome: string;
              http_status: number | null;
              provider_fault: string | null;
              created_at: string;
              finished_at: string | null;
            }>(sql`
              SELECT id, attempt_number, step, outcome, http_status, provider_fault,
                     to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS created_at,
                     to_char(finished_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS finished_at
                FROM command_attempt WHERE command_id = ${input.id}::uuid
               ORDER BY attempt_number`)),
          ];
          return {
            ...toCommandRow(raw),
            payload: raw.payload,
            targetObject: null,
            attempts: attempts.map((attempt) => ({
              id: attempt.id,
              attemptNumber: attempt.attempt_number,
              step: attempt.step,
              outcome: attempt.outcome,
              httpStatus: attempt.http_status,
              providerFault: attempt.provider_fault,
              createdAt: attempt.created_at,
              finishedAt: attempt.finished_at,
            })),
          };
        }),
      ),
    submit: withOrganization.commands.submit.handler(({ context, input }) =>
      submitCommand(context, input),
    ),
  },
  approvals: {
    pending: withOrganization.approvals.pending
      .use(validated(ApprovalsPendingResult))
      .handler(({ context, input }) => listApprovals(context, input)),
    decide: withOrganization.approvals.decide
      .use(validated(DecideResult))
      .handler(async ({ context, input }) => {
        const approverUserId = await requireOwnerAdmin(context.headers);
        return decideApproval(context, approverUserId, input);
      }),
  },
};
