import "server-only";
import type { ObjectRefKind } from "@lfsci/contracts";

/**
 * Only the kinds that have a screen of their own; anything else renders without a
 * link rather than sending the owner to a route that does not exist.
 */
const ROUTES: Partial<Record<ObjectRefKind, (id: string) => string>> = {
  legal_entity: (id) => `/patrimoine/sci/${id}`,
  building: (id) => `/patrimoine/immeubles/${id}`,
  unit: (id) => `/patrimoine/lots/${id}`,
  person: (id) => `/locations/locataires/${id}`,
  lease: (id) => `/locations/baux/${id}`,
  expense: (id) => `/finance/depenses/${id}`,
  loan: (id) => `/finance/credits/${id}`,
  intervention: (id) => `/travaux/interventions/${id}`,
  claim: (id) => `/travaux/sinistres/${id}`,
  insurance_policy: (id) => `/patrimoine/assurances/${id}`,
  document: () => "/documents",
};

export function objectHref(kind: string | null, id: string | null): string | null {
  if (!kind || !id) return null;
  return ROUTES[kind as ObjectRefKind]?.(id) ?? null;
}
