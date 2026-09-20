import accueil from "./accueil.json";
import assistant from "./assistant.json";
import commands from "./commands.json";
import common from "./common.json";
import documents from "./documents.json";
import echeancier from "./echeancier.json";
import finance from "./finance.json";
import inbox from "./inbox.json";
import locations from "./locations.json";
import patrimoine from "./patrimoine.json";
import travaux from "./travaux.json";

// Each feature module owns its JSON; namespaces must not collide with common's top-level keys.
export const messages = {
  ...common,
  ...accueil,
  ...assistant,
  ...commands,
  ...documents,
  ...echeancier,
  ...finance,
  ...inbox,
  ...locations,
  ...patrimoine,
  ...travaux,
};

export type Messages = typeof messages;
