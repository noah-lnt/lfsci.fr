import accueil from "./accueil.json";
import acquisitions from "./acquisitions.json";
import assistant from "./assistant.json";
import assurances from "./assurances.json";
import charges from "./charges.json";
import commands from "./commands.json";
import common from "./common.json";
import courteDuree from "./courte-duree.json";
import documents from "./documents.json";
import echeancier from "./echeancier.json";
import finance from "./finance.json";
import inbox from "./inbox.json";
import inspections from "./inspections.json";
import locations from "./locations.json";
import parametres from "./parametres.json";
import patrimoine from "./patrimoine.json";
import recherche from "./recherche.json";
import recouvrement from "./recouvrement.json";
import revisions from "./revisions.json";
import travaux from "./travaux.json";

// Each feature module owns its JSON; namespaces must not collide with common's top-level keys.
export const messages = {
  ...common,
  ...accueil,
  ...acquisitions,
  ...assistant,
  ...assurances,
  ...charges,
  ...commands,
  ...courteDuree,
  ...documents,
  ...echeancier,
  ...finance,
  ...inbox,
  ...inspections,
  ...locations,
  ...parametres,
  ...patrimoine,
  ...recherche,
  ...recouvrement,
  ...revisions,
  ...travaux,
};

export type Messages = typeof messages;
