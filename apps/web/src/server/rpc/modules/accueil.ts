import "server-only";
import { ActionRequiredResult, SituationResult } from "@/lib/contracts/accueil";
import { buildCards } from "../../accueil/cards";
import { loadCardSource, loadSituation } from "../../accueil/query";
import { validated, withOrganization } from "../base";

export const accueilRouter = {
  accueil: {
    actionRequired: withOrganization.accueil.actionRequired
      .use(validated(ActionRequiredResult))
      .handler(async ({ context, input }) => {
        const source = await loadCardSource(context);
        return { cards: buildCards(source).slice(0, input.limit) };
      }),
    situation: withOrganization.accueil.situation
      .use(validated(SituationResult))
      .handler(({ context }) => loadSituation(context)),
  },
};
