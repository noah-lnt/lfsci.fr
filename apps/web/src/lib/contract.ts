import { oc } from "@orpc/contract";
import { z } from "zod";
import { accueilContract } from "./contracts/accueil";
import { acquisitionsContract } from "./contracts/acquisitions";
import { assistantContract } from "./contracts/assistant";
import { assurancesContract } from "./contracts/assurances";
import { chargesContract } from "./contracts/charges";
import { commandsContract } from "./contracts/commands";
import { courteDureeContract } from "./contracts/courte-duree";
import { documentsContract } from "./contracts/documents";
import { echeancierContract } from "./contracts/echeancier";
import { financeContract } from "./contracts/finance";
import { inboxContract } from "./contracts/inbox";
import { inspectionsContract } from "./contracts/inspections";
import { locationsContract } from "./contracts/locations";
import { opsProcedures } from "./contracts/ops";
import { parametresContract } from "./contracts/parametres";
import { patrimoineContract } from "./contracts/patrimoine";
import { rechercheContract } from "./contracts/recherche";
import { recouvrementContract } from "./contracts/recouvrement";
import { revisionsContract } from "./contracts/revisions";
import { travauxContract } from "./contracts/travaux";

export const ComponentStatus = z.enum(["up", "down", "unknown"]);
export type ComponentStatus = z.infer<typeof ComponentStatus>;

export const ReadyResult = z.object({
  status: z.enum(["ready", "degraded"]),
  requestId: z.string(),
  components: z.object({
    database: ComponentStatus,
    storage: ComponentStatus,
    queue: ComponentStatus,
    /** The local model: `down` degrades the AI screens, it never makes the app unready. */
    model: ComponentStatus,
  }),
});
export type ReadyResult = z.infer<typeof ReadyResult>;

export const MeResult = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    twoFactorEnabled: z.boolean(),
  }),
  activeOrganizationId: z.string().nullable(),
  organizations: z.array(
    z.object({ id: z.string(), name: z.string(), slug: z.string(), role: z.string().nullable() }),
  ),
});
export type MeResult = z.infer<typeof MeResult>;

export const EchoInput = z.object({ note: z.string().max(200).optional() });
export type EchoInput = z.infer<typeof EchoInput>;

export const EchoResult = z.object({
  requestId: z.string(),
  receivedAt: z.iso.datetime({ offset: true }),
  note: z.string().nullable(),
});
export type EchoResult = z.infer<typeof EchoResult>;

// Each feature module owns its file under ./contracts; this object only assembles them.
export const contract = {
  health: {
    ready: oc
      .route({ method: "GET", path: "/health/ready", summary: "Disponibilité des composants" })
      .output(ReadyResult),
  },
  me: {
    get: oc
      .route({ method: "GET", path: "/me", summary: "Session courante et organisations" })
      .output(MeResult),
  },
  ops: {
    echo: oc
      .route({ method: "POST", path: "/ops/echo", summary: "Renvoie l’identifiant de corrélation" })
      .input(EchoInput)
      .output(EchoResult),
    ...opsProcedures,
  },
  ...accueilContract,
  ...acquisitionsContract,
  ...assistantContract,
  ...assurancesContract,
  ...chargesContract,
  ...commandsContract,
  ...courteDureeContract,
  ...documentsContract,
  ...echeancierContract,
  ...financeContract,
  ...inboxContract,
  ...inspectionsContract,
  ...locationsContract,
  ...parametresContract,
  ...patrimoineContract,
  ...rechercheContract,
  ...recouvrementContract,
  ...revisionsContract,
  ...travauxContract,
};

export type AppContract = typeof contract;
