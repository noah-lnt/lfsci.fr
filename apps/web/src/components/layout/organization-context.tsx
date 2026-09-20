"use client";

import { createContext, useContext } from "react";

const OrganizationContext = createContext<string | null>(null);

export function OrganizationProvider({
  organizationId,
  children,
}: {
  organizationId: string | null;
  children: React.ReactNode;
}) {
  return <OrganizationContext value={organizationId}>{children}</OrganizationContext>;
}

/** The organization the server session already resolved, known before any query answers. */
export function useSessionOrganizationId(): string | null {
  return useContext(OrganizationContext);
}
