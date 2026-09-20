import "server-only";
import { Equipment, Intervention, Meter, paginated, WorksProject } from "@lfsci/contracts";
import {
  EquipmentRow,
  InterventionDetail,
  MeterReadingRow,
  MeterRow,
  TravauxLookups,
  WorksProjectDetail,
  WorksProjectRow,
} from "@/lib/contracts/travaux";
import { tenant } from "../../data";
import { travauxLookups } from "../../finance/lookups";
import { createEquipment, listEquipment, updateEquipment } from "../../travaux/equipment";
import {
  createIntervention,
  getIntervention,
  listInterventions,
  transitionIntervention,
} from "../../travaux/interventions";
import { createMeter, listMeters, listReadings, recordReading } from "../../travaux/meters";
import { createProject, getProject, listProjects, updateProject } from "../../travaux/projects";
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

export const travauxRouter = {
  travaux: {
    lookups: withOrganization.travaux.lookups
      .use(validated(TravauxLookups))
      .handler(({ context }) => tenant(scope(context), (tx) => travauxLookups(tx))),
    projects: {
      list: withOrganization.travaux.projects.list
        .use(validated(paginated(WorksProjectRow)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listProjects(tx, input))),
      get: withOrganization.travaux.projects.get
        .use(validated(WorksProjectDetail))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getProject(tx, input.id))),
      create: withOrganization.travaux.projects.create
        .use(validated(WorksProject))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createProject(tx, actorOf(context), input)),
        ),
      update: withOrganization.travaux.projects.update
        .use(validated(WorksProject))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateProject(tx, actorOf(context), input)),
        ),
    },
    interventions: {
      list: withOrganization.travaux.interventions.list
        .use(validated(paginated(Intervention)))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => listInterventions(tx, input)),
        ),
      get: withOrganization.travaux.interventions.get
        .use(validated(InterventionDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => getIntervention(tx, input.id)),
        ),
      create: withOrganization.travaux.interventions.create
        .use(validated(Intervention))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createIntervention(tx, actorOf(context), input)),
        ),
      transition: withOrganization.travaux.interventions.transition
        .use(validated(InterventionDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => transitionIntervention(tx, actorOf(context), input)),
        ),
    },
    equipment: {
      list: withOrganization.travaux.equipment.list
        .use(validated(paginated(EquipmentRow)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listEquipment(tx, input))),
      create: withOrganization.travaux.equipment.create
        .use(validated(Equipment))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createEquipment(tx, actorOf(context), input)),
        ),
      update: withOrganization.travaux.equipment.update
        .use(validated(Equipment))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateEquipment(tx, actorOf(context), input)),
        ),
    },
    meters: {
      list: withOrganization.travaux.meters.list
        .use(validated(paginated(MeterRow)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listMeters(tx, input))),
      create: withOrganization.travaux.meters.create
        .use(validated(Meter))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createMeter(tx, actorOf(context), input)),
        ),
      readings: {
        list: withOrganization.travaux.meters.readings.list
          .use(validated(paginated(MeterReadingRow)))
          .handler(({ context, input }) => tenant(scope(context), (tx) => listReadings(tx, input))),
        record: withOrganization.travaux.meters.readings.record
          .use(validated(MeterReadingRow))
          .handler(({ context, input }) =>
            tenant(scope(context), (tx) => recordReading(tx, actorOf(context), input)),
          ),
      },
    },
  },
};
