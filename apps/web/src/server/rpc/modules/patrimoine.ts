import "server-only";
import { api } from "@lfsci/contracts";
import { SetUnitUsageOutput } from "@/lib/contracts/patrimoine";
import { tenant } from "../../data";
import * as repository from "../../patrimoine/repository";
import { readTimeline } from "../../patrimoine/timeline";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

function scope(
  context: RpcContext & { organizationId: string; session: NonNullable<RpcContext["session"]> },
) {
  return { organizationId: context.organizationId, actorId: context.session.user.id };
}

export const patrimoineRouter = {
  patrimoine: {
    legalEntities: {
      list: withOrganization.patrimoine.legalEntities.list
        .use(validated(api.patrimoine.listLegalEntities.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) =>
            repository.listLegalEntities(tx, {
              limit: input.limit,
              cursor: input.cursor,
              status: input.status,
              search: input.search,
            }),
          ),
        ),
      get: withOrganization.patrimoine.legalEntities.get
        .use(validated(api.patrimoine.getLegalEntity.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) => repository.getLegalEntity(tx, input.id)),
        ),
      create: withOrganization.patrimoine.legalEntities.create
        .use(validated(api.patrimoine.createLegalEntity.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) => repository.createLegalEntity(tx, scope(context), input)),
        ),
      update: withOrganization.patrimoine.legalEntities.update
        .use(validated(api.patrimoine.updateLegalEntity.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) => repository.updateLegalEntity(tx, scope(context), input)),
        ),
    },
    buildings: {
      list: withOrganization.patrimoine.buildings.list
        .use(validated(api.patrimoine.listBuildings.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) =>
            repository.listBuildings(tx, {
              limit: input.limit,
              cursor: input.cursor,
              legalEntityId: input.legalEntityId,
              status: input.status,
              search: input.search,
            }),
          ),
        ),
      get: withOrganization.patrimoine.buildings.get
        .use(validated(api.patrimoine.getBuilding.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) => repository.getBuilding(tx, input.id)),
        ),
      create: withOrganization.patrimoine.buildings.create
        .use(validated(api.patrimoine.createBuilding.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) => repository.createBuilding(tx, scope(context), input)),
        ),
      update: withOrganization.patrimoine.buildings.update
        .use(validated(api.patrimoine.updateBuilding.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) => repository.updateBuilding(tx, scope(context), input)),
        ),
    },
    units: {
      list: withOrganization.patrimoine.units.list
        .use(validated(api.patrimoine.listUnits.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) =>
            repository.listUnits(tx, {
              limit: input.limit,
              cursor: input.cursor,
              buildingId: input.buildingId,
              legalEntityId: input.legalEntityId,
              kind: input.kind,
              status: input.status,
            }),
          ),
        ),
      get: withOrganization.patrimoine.units.get
        .use(validated(api.patrimoine.getUnit.output))
        .handler(({ context, input }) => tenant(context, (tx) => repository.getUnit(tx, input.id))),
      create: withOrganization.patrimoine.units.create
        .use(validated(api.patrimoine.createUnit.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) => repository.createUnit(tx, scope(context), input)),
        ),
      update: withOrganization.patrimoine.units.update
        .use(validated(api.patrimoine.updateUnit.output))
        .handler(({ context, input }) =>
          tenant(context, (tx) => repository.updateUnit(tx, scope(context), input)),
        ),
      setUsage: withOrganization.patrimoine.units.setUsage
        .use(validated(SetUnitUsageOutput))
        .handler(({ context, input }) =>
          tenant(context, (tx) => repository.setUnitUsage(tx, scope(context), input)),
        ),
    },
    timeline: withOrganization.patrimoine.timeline
      .use(validated(api.patrimoine.getTimeline.output))
      .handler(({ context, input }) =>
        tenant(context, (tx) =>
          readTimeline(tx, {
            object: input.object,
            limit: input.limit,
            cursor: input.cursor,
            from: input.from,
            to: input.to,
            kinds: input.kinds,
          }),
        ),
      ),
  },
};
