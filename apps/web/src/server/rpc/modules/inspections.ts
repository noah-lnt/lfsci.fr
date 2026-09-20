import "server-only";
import { Inspection, InspectionFinding, InventoryItem, paginated } from "@lfsci/contracts";
import { z } from "zod";
import {
  ComparisonRead,
  DepositSettlementRead,
  InspectionDetail,
  InspectionRow,
} from "@/lib/contracts/inspections";
import { tenant } from "../../data";
import {
  addFinding,
  addInventoryItem,
  comparisonFor,
  createInspection,
  getInspection,
  listInspections,
  listInventory,
  removeFinding,
  removeInspection,
  removeInventoryItem,
  settlementFor,
  updateFinding,
  updateInspection,
  updateInventoryItem,
} from "../../inspections/repository";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

type Scoped = RpcContext & { organizationId: string };

const Removed = z.object({ id: z.uuid() });

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

export const inspectionsRouter = {
  inspections: {
    list: withOrganization.inspections.list
      .use(validated(paginated(InspectionRow)))
      .handler(({ context, input }) => tenant(scope(context), (tx) => listInspections(tx, input))),
    get: withOrganization.inspections.get
      .use(validated(InspectionDetail))
      .handler(({ context, input }) => tenant(scope(context), (tx) => getInspection(tx, input.id))),
    create: withOrganization.inspections.create
      .use(validated(Inspection))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => createInspection(tx, actorOf(context), input)),
      ),
    update: withOrganization.inspections.update
      .use(validated(Inspection))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => updateInspection(tx, actorOf(context), input)),
      ),
    remove: withOrganization.inspections.remove
      .use(validated(Removed))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => removeInspection(tx, actorOf(context), input)),
      ),
    findings: {
      add: withOrganization.inspections.findings.add
        .use(validated(InspectionFinding))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => addFinding(tx, actorOf(context), input)),
        ),
      update: withOrganization.inspections.findings.update
        .use(validated(InspectionFinding))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateFinding(tx, actorOf(context), input)),
        ),
      remove: withOrganization.inspections.findings.remove
        .use(validated(Removed))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => removeFinding(tx, actorOf(context), input)),
        ),
    },
    inventory: {
      list: withOrganization.inspections.inventory.list
        .use(validated(paginated(InventoryItem)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listInventory(tx, input))),
      add: withOrganization.inspections.inventory.add
        .use(validated(InventoryItem))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => addInventoryItem(tx, actorOf(context), input)),
        ),
      update: withOrganization.inspections.inventory.update
        .use(validated(InventoryItem))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateInventoryItem(tx, actorOf(context), input)),
        ),
      remove: withOrganization.inspections.inventory.remove
        .use(validated(Removed))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => removeInventoryItem(tx, actorOf(context), input)),
        ),
    },
    comparison: withOrganization.inspections.comparison
      .use(validated(ComparisonRead))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => comparisonFor(tx, input.leaseId)),
      ),
    settlement: withOrganization.inspections.settlement
      .use(validated(DepositSettlementRead))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => settlementFor(tx, input.leaseId)),
      ),
  },
};
