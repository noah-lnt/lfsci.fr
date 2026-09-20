import "server-only";
import { AppError } from "@lfsci/kernel";
import { EchoResult } from "@/lib/contract";
import { OpsIntegrationsResult, OpsQueuesResult, OpsSearchResult } from "@/lib/contracts/ops";
import { auth } from "../../auth";
import { integrationHealth, queueStats, searchByRequestId } from "../../ops/search";
import { authed, validated, withOrganization } from "../base";

/** Tech pack §10.1: the ops screen is reserved to owner_admin. */
async function requireOwnerAdmin(headers: Headers): Promise<void> {
  const member = await auth().api.getActiveMember({ headers });
  if (member?.role !== "owner_admin") throw new AppError("FORBIDDEN");
}

export const ops = {
  echo: authed.ops.echo.use(validated(EchoResult)).handler(async ({ context, input }) => ({
    requestId: context.requestId,
    receivedAt: new Date().toISOString(),
    note: input.note ?? null,
  })),
  search: withOrganization.ops.search
    .use(validated(OpsSearchResult))
    .handler(async ({ context, input }) => {
      await requireOwnerAdmin(context.headers);
      return searchByRequestId(context, input.requestId);
    }),
  queues: withOrganization.ops.queues
    .use(validated(OpsQueuesResult))
    .handler(async ({ context }) => {
      await requireOwnerAdmin(context.headers);
      return queueStats(context);
    }),
  integrations: withOrganization.ops.integrations
    .use(validated(OpsIntegrationsResult))
    .handler(async ({ context }) => {
      await requireOwnerAdmin(context.headers);
      return integrationHealth(context);
    }),
};
