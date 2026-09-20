import type { DbHandle } from "@lfsci/db";
import { withTenant } from "@lfsci/db";
import { sql } from "drizzle-orm";
import type { ExistingRows } from "./model";
import { SourceUnreachable } from "./model";

export async function readExistingRows(
  db: DbHandle,
  organizationId: string,
): Promise<ExistingRows> {
  try {
    return await withTenant(db, { organizationId }, async (tx) => {
      const entities = [
        ...(await tx.execute<{ id: string; name: string; odoo_company_id: number | null }>(
          sql`SELECT id, name, odoo_company_id FROM legal_entity ORDER BY name`,
        )),
      ];
      const persons = [
        ...(await tx.execute<{
          id: string;
          display_name: string;
          odoo_partner_id: number | null;
          emails: string[] | null;
        }>(sql`
          SELECT p.id, p.display_name, p.odoo_partner_id,
                 (SELECT array_agg(c.value) FROM contact_point c
                   WHERE c.person_id = p.id AND c.kind = 'email' AND c.status = 'active') AS emails
            FROM person p
           WHERE p.status <> 'pseudonymized'
           ORDER BY p.display_name`)),
      ];
      const suppliers = [
        ...(await tx.execute<{ id: string; name: string; odoo_partner_id: number | null }>(
          sql`SELECT id, name, odoo_partner_id FROM supplier WHERE status <> 'archived' ORDER BY name`,
        )),
      ];
      const leases = [
        ...(await tx.execute<{
          id: string;
          reference: string;
          legal_entity_id: string;
          holders: string[] | null;
        }>(sql`
          SELECT l.id, l.reference, l.legal_entity_id,
                 (SELECT array_agg(lp.person_id) FROM lease_party lp
                   WHERE lp.lease_id = l.id AND lp.role IN ('holder', 'co_holder')) AS holders
            FROM lease l
           ORDER BY l.reference`)),
      ];
      const buildings = [
        ...(await tx.execute<{ id: string; code: string; legal_entity_id: string }>(
          sql`SELECT id, code, legal_entity_id FROM building ORDER BY code`,
        )),
      ];
      return {
        entities: entities.map((e) => ({
          id: e.id,
          name: e.name,
          odooCompanyId: e.odoo_company_id,
        })),
        persons: persons.map((p) => ({
          id: p.id,
          displayName: p.display_name,
          odooPartnerId: p.odoo_partner_id,
          emails: p.emails ?? [],
        })),
        suppliers: suppliers.map((s) => ({
          id: s.id,
          name: s.name,
          odooPartnerId: s.odoo_partner_id,
        })),
        leases: leases.map((l) => ({
          id: l.id,
          reference: l.reference,
          legalEntityId: l.legal_entity_id,
          holderPersonIds: l.holders ?? [],
        })),
        buildings: buildings.map((b) => ({
          id: b.id,
          code: b.code,
          legalEntityId: b.legal_entity_id,
        })),
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceUnreachable("spreadsheet", `Base de l’application injoignable : ${message}`, {
      cause: error,
    });
  }
}
