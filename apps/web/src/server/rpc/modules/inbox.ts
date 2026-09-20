import "server-only";
import { z } from "zod";
import {
  AttachTarget,
  InboxDecisionResult,
  InboxDetail,
  InboxListResult,
  InboxRow,
  RuleProposalDecisionResult,
  RuleProposalsResult,
} from "@/lib/contracts/inbox";
import { captureNote } from "../../inbox/capture";
import { decideInbox } from "../../inbox/decide";
import { decideRuleProposal, listRuleProposals } from "../../inbox/proposals";
import { getInbox, listAttachTargets, listInbox } from "../../inbox/queries";
import { validated, withOrganization } from "../base";

const AttachTargetsResult = z.object({ items: z.array(AttachTarget) });

export const inboxRouter = {
  inbox: {
    list: withOrganization.inbox.list
      .use(validated(InboxListResult))
      .handler(({ context, input }) => listInbox(context, input)),
    get: withOrganization.inbox.get
      .use(validated(InboxDetail))
      .handler(({ context, input }) => getInbox(context, input.id)),
    decide: withOrganization.inbox.decide
      .use(validated(InboxDecisionResult))
      .handler(({ context, input }) => decideInbox(context, input)),
    targets: withOrganization.inbox.targets
      .use(validated(AttachTargetsResult))
      .handler(({ context, input }) => listAttachTargets(context, input)),
    captureNote: withOrganization.inbox.captureNote
      .use(validated(InboxRow))
      .handler(({ context, input }) => captureNote(context, input)),
    ruleProposals: withOrganization.inbox.ruleProposals
      .use(validated(RuleProposalsResult))
      .handler(({ context }) => listRuleProposals(context)),
    decideRuleProposal: withOrganization.inbox.decideRuleProposal
      .use(validated(RuleProposalDecisionResult))
      .handler(({ context, input }) => decideRuleProposal(context, input)),
  },
};
