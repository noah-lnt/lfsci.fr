import { z } from "zod";

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const Currency = z.string().length(3).default("EUR");

export const Money = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, "montant décimal attendu, 2 décimales maximum");
export type Money = z.infer<typeof Money>;

export const Share = z
  .string()
  .regex(/^(0|1)(\.\d{1,6})?$/, "part entre 0 et 1, 6 décimales maximum");
export type Share = z.infer<typeof Share>;

export const Version = z.number().int().positive();

export const Cursor = z.string().min(1).max(512);

export const Page = z.object({
  cursor: Cursor.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type Page = z.infer<typeof Page>;

export const Audited = z.object({
  id: Uuid,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime.nullable(),
  version: Version,
});
