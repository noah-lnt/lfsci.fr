"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { LinkButton } from "@/components/ui/link-button";
import { Skeleton } from "@/components/ui/skeleton";
import type { RuleProposalDecisionInput } from "@/lib/contracts/inbox";
import { errorPayload, rpc } from "@/lib/rpc";

/**
 * IA-06: the proposal is shown where the owner already triages. Activating submits
 * an `activate_rule` command for approval — this screen never activates anything.
 */
export function RuleProposals() {
  const t = useTranslations("inbox");
  const queryClient = useQueryClient();

  const proposals = useQuery({
    queryKey: ["inbox", "ruleProposals"],
    queryFn: () => rpc.inbox.ruleProposals(),
  });

  const decide = useMutation({
    mutationFn: (input: RuleProposalDecisionInput) => rpc.inbox.decideRuleProposal(input),
    onSuccess: async (result) => {
      toast.success(
        result.outcome === "awaiting_approval"
          ? t("proposals.submitted")
          : t("proposals.dismissed"),
      );
      await queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const items = proposals.data?.items ?? [];
  const awaiting = proposals.data?.awaitingApproval ?? 0;
  const dismissed = proposals.data?.dismissed ?? 0;

  return (
    <section
      aria-labelledby="inbox-proposals-title"
      className="space-y-3 rounded-xl border bg-card p-4"
      data-testid="inbox-proposals"
    >
      <h2 id="inbox-proposals-title" className="text-sm font-medium">
        {t("proposals.title")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t("proposals.hint", { count: proposals.data?.minConfirmations ?? 3 })}
      </p>

      {proposals.error ? <ErrorBox error={errorPayload(proposals.error)} /> : null}
      {decide.error ? <ErrorBox error={errorPayload(decide.error)} /> : null}

      {awaiting > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("proposals.awaitingApproval", { count: awaiting })}</span>
          <LinkButton href="/validations" variant="outline" size="sm">
            {t("proposals.seeValidations")}
          </LinkButton>
        </p>
      ) : null}

      {proposals.isPending ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="inbox-proposals-empty">
          {t("proposals.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((proposal) => (
            <li
              key={proposal.code}
              data-testid="inbox-proposal"
              className="space-y-2 rounded-xl border p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">{t(`proposals.origin.${proposal.originKind}`)}</Badge>
                <span className="font-medium text-foreground">{proposal.originLabel}</span>
                <Badge variant={proposal.recoverable ? "secondary" : "ghost"}>
                  {proposal.recoverable
                    ? t("proposals.recoverable")
                    : t("proposals.notRecoverable")}
                </Badge>
              </div>

              <p className="text-sm">
                {t("proposals.effect")} : {t(`proposals.target.${proposal.target}`)}{" "}
                <span className="font-medium">{proposal.targetLabel}</span>
                {proposal.category ? ` · ${t("proposals.category")} : ${proposal.category}` : null}
                {proposal.accountHint
                  ? ` · ${t("proposals.accountHint")} : ${proposal.accountHint}`
                  : null}
              </p>

              <p className="text-xs text-muted-foreground">
                {t("proposals.basis", {
                  count: proposal.confirmationCount,
                  from: proposal.firstConfirmedOn,
                  to: proposal.lastConfirmedOn,
                })}
              </p>

              <div>
                <h3 className="text-xs font-medium">{t("proposals.examples")}</h3>
                <ul className="mt-1 space-y-1">
                  {proposal.examples.map((example) => (
                    <li key={example.id} className="text-xs text-muted-foreground">
                      <DateValue value={example.confirmedOn} /> — {example.label}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-muted-foreground">{t("proposals.activateHint")}</p>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ code: proposal.code, decision: "activate" })}
                >
                  {t("proposals.activate")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ code: proposal.code, decision: "dismiss" })}
                >
                  {t("proposals.dismiss")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dismissed > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("proposals.dismissedCount", { count: dismissed })}
        </p>
      ) : null}
    </section>
  );
}
