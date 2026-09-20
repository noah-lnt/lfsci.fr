"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { DateValue } from "@/components/ui/date";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PendingApproval } from "@/lib/contracts/commands";
import { errorPayload, rpc } from "@/lib/rpc";
import { ApprovalCard } from "./approval-card";

export function ValidationsView() {
  const t = useTranslations("validations");
  const queryClient = useQueryClient();

  const approvals = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => rpc.approvals.pending({ historyLimit: 20 }),
  });

  const decide = useMutation({
    mutationFn: (input: {
      approval: PendingApproval;
      decision: "approved" | "refused";
      reason?: string;
    }) =>
      rpc.approvals.decide({
        commandId: input.approval.commandId,
        expectedVersion: input.approval.version,
        payloadHash: input.approval.payloadHash,
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    onSuccess: async (_result, variables) => {
      toast.success(variables.decision === "approved" ? t("approved") : t("refused"));
      await queryClient.invalidateQueries({ queryKey: ["approvals"] });
      await queryClient.invalidateQueries({ queryKey: ["accueil"] });
    },
  });

  const failed = approvals.error ?? decide.error;
  const pending = approvals.data?.pending ?? [];
  const decided = approvals.data?.decided ?? [];

  return (
    <div className="space-y-6">
      {failed ? <ErrorBox error={errorPayload(failed)} /> : null}

      <section aria-label={t("pending")}>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("pending")}</h2>
        {approvals.isPending ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : pending.length === 0 ? (
          <div
            className="rounded-xl border border-dashed bg-card p-8 text-center"
            data-testid="validations-empty"
          >
            <h3 className="text-sm font-medium">{t("empty")}</h3>
            <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
              {t("emptyHint")}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((approval) => (
              <ApprovalCard
                key={approval.commandId}
                approval={approval}
                pending={decide.isPending}
                onDecide={(input) => decide.mutate({ approval, ...input })}
              />
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 ? (
        <section aria-label={t("history")}>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("history")}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pieces")}</TableHead>
                <TableHead>{t("decision.approved")}</TableHead>
                <TableHead>{t("decidedAt")}</TableHead>
                <TableHead>{t("expiresAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decided.map((row) => (
                <TableRow key={row.approvalId}>
                  <TableCell>{row.commandType}</TableCell>
                  <TableCell>
                    <Badge variant={row.decision === "approved" ? "secondary" : "destructive"}>
                      {t(`decision.${row.decision}`)}
                    </Badge>
                    {row.reason ? (
                      <span className="ml-2 text-xs text-muted-foreground">{row.reason}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <DateValue value={row.decidedAt} withTime />
                  </TableCell>
                  <TableCell>
                    <DateValue value={row.expiresAt} withTime />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}
