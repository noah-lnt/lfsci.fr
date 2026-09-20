import "server-only";
import { accueilRouter } from "./modules/accueil";
import { acquisitionsRouter } from "./modules/acquisitions";
import { assistantRouter } from "./modules/assistant";
import { assurancesRouter } from "./modules/assurances";
import { chargesRouter } from "./modules/charges";
import { commandsRouter } from "./modules/commands";
import { courteDureeRouter } from "./modules/courte-duree";
import { documentsRouter } from "./modules/documents";
import { echeancierRouter } from "./modules/echeancier";
import { financeRouter } from "./modules/finance";
import { health } from "./modules/health";
import { inboxRouter } from "./modules/inbox";
import { inspectionsRouter } from "./modules/inspections";
import { locationsRouter } from "./modules/locations";
import { me } from "./modules/me";
import { ops } from "./modules/ops";
import { parametresRouter } from "./modules/parametres";
import { patrimoineRouter } from "./modules/patrimoine";
import { rechercheRouter } from "./modules/recherche";
import { recouvrementRouter } from "./modules/recouvrement";
import { revisionsRouter } from "./modules/revisions";
import { travauxRouter } from "./modules/travaux";

// Each feature module owns its file under ./modules; this object only assembles them.
export const router = {
  health,
  me,
  ops,
  ...accueilRouter,
  ...acquisitionsRouter,
  ...assistantRouter,
  ...assurancesRouter,
  ...chargesRouter,
  ...commandsRouter,
  ...courteDureeRouter,
  ...documentsRouter,
  ...echeancierRouter,
  ...financeRouter,
  ...inboxRouter,
  ...inspectionsRouter,
  ...locationsRouter,
  ...parametresRouter,
  ...patrimoineRouter,
  ...rechercheRouter,
  ...recouvrementRouter,
  ...revisionsRouter,
  ...travauxRouter,
};
export type AppRouter = typeof router;
