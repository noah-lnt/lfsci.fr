import { z } from "zod";
import { byId, InboxDecisionInput, InboxItem, listInput, paginated } from "../entities";
import { InboxItemSource, InboxItemStatus } from "../enums";

export const listInboxItems = {
  input: listInput({
    status: InboxItemStatus.optional(),
    source: InboxItemSource.optional(),
    openOnly: z.boolean().optional(),
  }),
  output: paginated(InboxItem),
};
export const getInboxItem = { input: byId, output: InboxItem };
export const decideInboxItem = { input: InboxDecisionInput, output: InboxItem };
