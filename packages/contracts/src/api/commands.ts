import { z } from "zod";
import { CommandEnvelope, CommandState, CommandType, SubmitCommandOutput } from "../commands";
import { byId, Command, listInput, paginated } from "../entities";
import { Uuid } from "../primitives";

/** POST /v1/commands — 202 accepted; the HTTP acceptance is not an accounting confirmation. */
export const submitCommand = { input: CommandEnvelope, output: SubmitCommandOutput };

/** GET /v1/commands/{id} */
export const getCommand = { input: byId, output: Command };

export const listCommands = {
  input: listInput({
    status: CommandState.optional(),
    commandType: CommandType.optional(),
    correlationId: Uuid.optional(),
  }),
  output: paginated(Command),
};

export const cancelCommand = {
  input: z.strictObject({ id: Uuid, reason: z.string().min(1) }),
  output: Command,
};
