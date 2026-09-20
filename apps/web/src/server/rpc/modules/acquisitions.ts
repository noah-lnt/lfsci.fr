import "server-only";
import { paginated } from "@lfsci/contracts";
import {
  ConvertOpportunityResult,
  OpportunityDetail,
  OpportunityRow,
} from "@/lib/contracts/acquisitions";
import {
  archiveOpportunity,
  convertOpportunity,
  createOpportunity,
  createScenario,
  getOpportunity,
  listOpportunities,
  removeScenario,
  updateOpportunity,
  updateScenario,
} from "../../acquisitions/opportunities";
import { tenant } from "../../data";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

type Scoped = RpcContext & { organizationId: string };

function actorOf(context: Scoped) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.session?.user.id ?? null,
  };
}

function scope(context: Scoped) {
  return {
    requestId: context.requestId,
    session: context.session,
    organizationId: context.organizationId,
  };
}

export const acquisitionsRouter = {
  acquisitions: {
    list: withOrganization.acquisitions.list
      .use(validated(paginated(OpportunityRow)))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => listOpportunities(tx, input)),
      ),
    get: withOrganization.acquisitions.get
      .use(validated(OpportunityDetail))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => getOpportunity(tx, input.id)),
      ),
    create: withOrganization.acquisitions.create
      .use(validated(OpportunityDetail))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => createOpportunity(tx, actorOf(context), input)),
      ),
    update: withOrganization.acquisitions.update
      .use(validated(OpportunityDetail))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => updateOpportunity(tx, actorOf(context), input)),
      ),
    archive: withOrganization.acquisitions.archive
      .use(validated(OpportunityDetail))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => archiveOpportunity(tx, actorOf(context), input)),
      ),
    scenarios: {
      create: withOrganization.acquisitions.scenarios.create
        .use(validated(OpportunityDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createScenario(tx, actorOf(context), input)),
        ),
      update: withOrganization.acquisitions.scenarios.update
        .use(validated(OpportunityDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateScenario(tx, actorOf(context), input)),
        ),
      remove: withOrganization.acquisitions.scenarios.remove
        .use(validated(OpportunityDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => removeScenario(tx, actorOf(context), input.id)),
        ),
    },
    convert: withOrganization.acquisitions.convert
      .use(validated(ConvertOpportunityResult))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => convertOpportunity(tx, actorOf(context), input)),
      ),
  },
};
