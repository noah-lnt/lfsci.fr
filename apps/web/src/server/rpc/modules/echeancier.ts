import "server-only";
import { DeadlineListResult, DeadlineRow } from "@/lib/contracts/echeancier";
import { completeDeadline, listDeadlines, postponeDeadline } from "../../echeancier/query";
import { validated, withOrganization } from "../base";

export const echeancierRouter = {
  echeancier: {
    list: withOrganization.echeancier.list
      .use(validated(DeadlineListResult))
      .handler(({ context, input }) => listDeadlines(context, input)),
    complete: withOrganization.echeancier.complete
      .use(validated(DeadlineRow))
      .handler(({ context, input }) => completeDeadline(context, input)),
    postpone: withOrganization.echeancier.postpone
      .use(validated(DeadlineRow))
      .handler(({ context, input }) => postponeDeadline(context, input)),
  },
};
