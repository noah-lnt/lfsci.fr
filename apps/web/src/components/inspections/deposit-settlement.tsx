"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Paperclip, PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UploadPanel } from "@/components/documents/upload-panel";
import { ErrorBox } from "@/components/feedback/error-box";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { PageNav } from "@/components/layout/page-nav";
import { DefinitionList, SectionTitle } from "@/components/locations/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { LinkButton } from "@/components/ui/link-button";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorPayload, rpc } from "@/lib/rpc";

/** EDL-03: the proof of repair that unlocks a retention. */
const JUSTIFICATION_RELATION = "invoice" as const;

function Justifications({ inspectionId }: { inspectionId: string }) {
  const t = useTranslations("inspections");
  const client = useQueryClient();

  const inspection = useQuery({
    queryKey: ["inspections", "detail", inspectionId],
    queryFn: () => rpc.inspections.get({ id: inspectionId }),
  });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["inspections"] });
  };

  const attach = useMutation({
    mutationFn: (documentId: string) =>
      rpc.documents.link({
        documentId,
        object: { kind: "inspection", id: inspectionId },
        relation: JUSTIFICATION_RELATION,
      }),
    onSuccess: async () => {
      toast.success(t("settlement.attached"));
      await refresh();
    },
  });

  const documents = inspection.data?.photos ?? [];

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <SectionTitle>{t("settlement.justificationsTitle")}</SectionTitle>
      <p className="text-sm text-muted-foreground">{t("settlement.justificationsHint")}</p>

      <UploadPanel
        object={{ kind: "inspection", id: inspectionId }}
        onUploaded={() => {
          void refresh();
        }}
      />

      {inspection.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {inspection.data && documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("photos.empty")}</p>
      ) : null}

      {documents.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {documents.map((document) => {
            const isJustification = document.relations.includes(JUSTIFICATION_RELATION);
            return (
              <li
                key={document.documentId}
                className="flex flex-wrap items-center gap-2"
                data-testid="justification-row"
              >
                <span className="font-medium">{document.title}</span>
                {isJustification ? (
                  <Badge variant="default">{t("settlement.justificationsTitle")}</Badge>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={attach.isPending}
                    onClick={() => attach.mutate(document.documentId)}
                  >
                    <Paperclip aria-hidden="true" />
                    {t("settlement.attach")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {attach.error ? <ErrorBox error={errorPayload(attach.error)} /> : null}
    </section>
  );
}

export function DepositSettlementView({ leaseId }: { leaseId: string }) {
  const t = useTranslations("inspections");

  const settlement = useQuery({
    queryKey: ["inspections", "settlement", leaseId],
    queryFn: () => rpc.inspections.settlement({ leaseId }),
  });

  if (settlement.isError) return <ErrorBox error={errorPayload(settlement.error)} />;

  const data = settlement.data;

  return (
    <div className="space-y-6">
      <PageNav
        title={t("settlement.title")}
        description={t("settlement.description")}
        icon={<PiggyBank className="size-5" aria-hidden="true" />}
      >
        <LinkButton href={`/locations/baux/${leaseId}/etats-des-lieux`} variant="outline" size="sm">
          <ArrowLeft aria-hidden="true" />
          {t("backToList")}
        </LinkButton>
      </PageNav>

      {settlement.isPending ? <Skeleton className="h-40 w-full" /> : null}

      {data ? (
        <section className="space-y-4 rounded-xl border bg-card p-4">
          <DefinitionList
            rows={[
              {
                label: t("settlement.contractual"),
                value: <Money amount={data.contractualDeposit} />,
              },
              { label: t("settlement.held"), value: <Money amount={data.depositHeld} /> },
              {
                label: t("settlement.keyHandover"),
                value: <DateValue value={data.keyHandoverDate} />,
              },
              {
                label: t("settlement.conforms"),
                value: (
                  <Badge variant={data.exitConforms ? "default" : "outline"}>
                    {data.exitConforms ? t("comparison.conforms") : t("comparison.notConforms")}
                  </Badge>
                ),
              },
              {
                label: t("settlement.deadlineMonths"),
                value:
                  data.deadlineMonths === null
                    ? "—"
                    : t("settlement.months", { count: data.deadlineMonths }),
              },
              {
                label: t("settlement.deadline"),
                value: (
                  <span data-testid="settlement-deadline">
                    <DateValue value={data.deadline} />
                  </span>
                ),
              },
              {
                label: t("settlement.totalDeductions"),
                value: <Money amount={data.totalDeductions} />,
              },
              {
                label: t("settlement.restitution"),
                value: (
                  <span data-testid="settlement-restitution">
                    <Money amount={data.restitution} />
                  </span>
                ),
              },
            ]}
          />
          {data.blockedReason ? (
            <p role="alert" className="text-sm text-destructive" data-testid="settlement-blocked">
              {t(`settlement.blocked.${data.blockedReason}`)}
            </p>
          ) : null}
        </section>
      ) : null}

      {data ? (
        <section className="space-y-4 rounded-xl border bg-card p-4">
          <SectionTitle>{t("settlement.deductionsTitle")}</SectionTitle>
          <p className="text-sm text-muted-foreground">{t("settlement.deductionsHint")}</p>
          {data.deductions.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="no-deduction">
              {t("settlement.deductionsEmpty")}
            </p>
          ) : (
            <ScrollRegion label={t("settlement.deductionsTitle")}>
              <Table>
                <caption className="sr-only">{t("settlement.deductionsTitle")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t("settlement.columns.label")}</TableHead>
                    <TableHead scope="col">{t("settlement.columns.amount")}</TableHead>
                    <TableHead scope="col">{t("settlement.columns.justifications")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.deductions.map((deduction) => (
                    <TableRow key={deduction.findingId} data-testid="deduction-row">
                      <TableCell>{deduction.label}</TableCell>
                      <TableCell>
                        <Money amount={deduction.amount} />
                      </TableCell>
                      <TableCell className="num">{deduction.justificationCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          )}
        </section>
      ) : null}

      {data && data.missingInventory.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <SectionTitle>{t("settlement.missingInventoryTitle")}</SectionTitle>
          <p className="text-sm text-muted-foreground" data-testid="missing-inventory-hint">
            {t("settlement.missingInventoryHint")}
          </p>
          <ul className="list-inside list-disc text-sm">
            {data.missingInventory.map((item) => (
              <li key={item.id}>{item.label}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {data?.exitInspectionId ? <Justifications inspectionId={data.exitInspectionId} /> : null}
    </div>
  );
}
