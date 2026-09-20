import { v7 as uuidv7, validate } from "uuid";

export function newId(): string {
  return uuidv7();
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && validate(value);
}
