import { z } from "zod";
import { ObjectRefKind } from "../enums";
import { Cursor, Page, Uuid, Version } from "../primitives";

export const ObjectRef = z.object({ kind: ObjectRefKind, id: Uuid });
export type ObjectRef = z.infer<typeof ObjectRef>;

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: Cursor.nullable() });

export const listInput = <T extends z.ZodRawShape>(filters: T) =>
  z.strictObject({ ...Page.shape, ...filters });

export const byId = z.strictObject({ id: Uuid });
export type ById = z.infer<typeof byId>;

export const expectedVersion = { expectedVersion: Version };
