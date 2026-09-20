import "server-only";
import { SearchCoverage, SearchResult } from "@/lib/contracts/recherche";
import { readCoverage } from "../../recherche/coverage";
import { search } from "../../recherche/query";
import { validated, withOrganization } from "../base";

export const rechercheRouter = {
  recherche: {
    search: withOrganization.recherche.search
      .use(validated(SearchResult))
      .handler(({ context, input }) => search(context, input)),
    coverage: withOrganization.recherche.coverage
      .use(validated(SearchCoverage))
      .handler(({ context }) => readCoverage(context)),
  },
};
