import "server-only";
import { accueilRouter } from "./modules/accueil";
import { assistantRouter } from "./modules/assistant";
import { commandsRouter } from "./modules/commands";
import { documentsRouter } from "./modules/documents";
import { echeancierRouter } from "./modules/echeancier";
import { financeRouter } from "./modules/finance";
import { health } from "./modules/health";
import { inboxRouter } from "./modules/inbox";
import { locationsRouter } from "./modules/locations";
import { me } from "./modules/me";
import { ops } from "./modules/ops";
import { patrimoineRouter } from "./modules/patrimoine";
import { travauxRouter } from "./modules/travaux";

// Each feature module owns its file under ./modules; this object only assembles them.
export const router = {
  health,
  me,
  ops,
  ...accueilRouter,
  ...assistantRouter,
  ...commandsRouter,
  ...documentsRouter,
  ...echeancierRouter,
  ...financeRouter,
  ...inboxRouter,
  ...locationsRouter,
  ...patrimoineRouter,
  ...travauxRouter,
};
export type AppRouter = typeof router;
