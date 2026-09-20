import { z } from "zod";
import {
  byId,
  ContactPoint,
  CreatePersonInput,
  listInput,
  Person,
  paginated,
  UpdatePersonInput,
} from "../entities";
import { PersonRoleRole, PersonStatus } from "../enums";

export const listPersons = {
  input: listInput({
    status: PersonStatus.optional(),
    role: PersonRoleRole.optional(),
    search: z.string().optional(),
  }),
  output: paginated(Person),
};
export const getPerson = {
  input: byId,
  output: Person.extend({ contactPoints: z.array(ContactPoint) }),
};
export const createPerson = { input: CreatePersonInput, output: Person };
export const updatePerson = { input: UpdatePersonInput, output: Person };
