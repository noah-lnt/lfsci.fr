import { listOrganizationIds } from "@lfsci/db";
import type { Deps } from "./deps";

/** Cross-organization loops read the registry on the admin handle, never through RLS. */
export function forEachOrganizationId(deps: Deps): Promise<string[]> {
  return listOrganizationIds(deps.admin);
}
