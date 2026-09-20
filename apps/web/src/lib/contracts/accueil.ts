import { api, IsoDate, IsoDateTime, Money, ObjectRef } from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** UX-01: a card names why it is there, what it blocks, what to do and what that changes. */
export const ActionCardKind = z.enum([
  "approval_pending",
  "late_rent",
  "inbox_ambiguous",
  "deadline_due",
  "command_exception",
  "document_missing",
]);
export type ActionCardKind = z.infer<typeof ActionCardKind>;

export const ActionCardSeverity = z.enum(["info", "warning", "critical"]);
export type ActionCardSeverity = z.infer<typeof ActionCardSeverity>;

export const ProposedAction = z.object({ label: z.string().min(1), href: z.string().min(1) });
export type ProposedAction = z.infer<typeof ProposedAction>;

export const ActionCard = z.object({
  id: z.string().min(1),
  kind: ActionCardKind,
  why: z.string().min(1),
  blocking: z.boolean(),
  proposedAction: ProposedAction,
  expectedEffect: z.string().min(1),
  severity: ActionCardSeverity,
  objectRefs: z.array(ObjectRef),
  occurredAt: IsoDateTime,
  groupedCount: z.number().int().min(2).optional(),
});
export type ActionCard = z.infer<typeof ActionCard>;

export const ActionRequiredResult = z.object({ cards: z.array(ActionCard) });
export type ActionRequiredResult = z.infer<typeof ActionRequiredResult>;

/** Every figure carries the date of the data behind it; absent means `—`, never 0. */
export const AmountIndicator = z.object({
  amount: Money.nullable(),
  currency: z.string().length(3),
  asOf: IsoDate.nullable(),
});
export type AmountIndicator = z.infer<typeof AmountIndicator>;

export const OccupancyIndicator = z.object({
  occupiedUnits: z.number().int().nonnegative(),
  totalUnits: z.number().int().nonnegative(),
  asOf: IsoDate.nullable(),
});
export type OccupancyIndicator = z.infer<typeof OccupancyIndicator>;

export const SituationResult = z.object({
  banner: api.actionRequired.SituationBanner,
  indicators: z.object({
    occupancy: OccupancyIndicator.nullable(),
    collectedThisMonth: AmountIndicator,
    cash: AmountIndicator,
    debt: AmountIndicator,
    partnerAccounts: AmountIndicator,
    netBookValue: AmountIndicator,
  }),
});
export type SituationResult = z.infer<typeof SituationResult>;

export const accueilContract = {
  accueil: {
    actionRequired: oc
      .route({
        method: "GET",
        path: "/accueil/action-required",
        summary: "Ce qui nécessite mon intervention",
      })
      .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
      .output(ActionRequiredResult),
    situation: oc
      .route({ method: "GET", path: "/accueil/situation", summary: "Bandeau de situation" })
      .output(SituationResult),
  },
};
