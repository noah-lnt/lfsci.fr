"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, TrendingUp, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { PageNav } from "@/components/layout/page-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function RevisionsView({ leaseId }: { leaseId: string }) {
  const t = useTranslations("revisions");
  const client = useQueryClient();

  const screen = useQuery({
    queryKey: ["revisions", leaseId],
    queryFn: () => rpc.revisions.get({ leaseId }),
  });

  const prepare = useMutation({
    mutationFn: () =>
      rpc.revisions.prepare({
        leaseId,
        expectedVersion: screen.data?.context.leaseVersion ?? 1,
      }),
    onSuccess: async () => {
      toast.success(t("proposal.prepared"));
      await client.invalidateQueries({ queryKey: ["revisions", leaseId] });
    },
  });

  const letter = useMutation({
    mutationFn: (revisionId: string) => rpc.revisions.letter({ revisionId }),
    onSuccess: async () => {
      toast.success(t("history.letterIssued"));
      await client.invalidateQueries({ queryKey: ["revisions", leaseId] });
    },
  });

  if (screen.isError) return <ErrorBox error={errorPayload(screen.error)} />;
  if (!screen.data) return <Skeleton className="h-64 w-full" />;

  const { context, proposal, history } = screen.data;

  return (
    <>
      <PageNav
        title={t("title")}
        description={`${context.leaseReference}${context.unitLabel ? ` · ${context.unitLabel}` : ""}`}
        icon={<TrendingUp className="size-5" aria-hidden="true" />}
      >
        <Link
          href={`/locations/baux/${leaseId}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft aria-hidden="true" />
          {t("back")}
        </Link>
      </PageNav>

      <div className="space-y-6">
        <section className="space-y-4 rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold tracking-tight">{t("context.title")}</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,16rem)_1fr]">
            <Row label={t("context.index")}>
              {context.indexName ? t(`indexName.${context.indexName}`) : "—"}
            </Row>
            <Row label={t("context.referenceQuarter")}>
              {context.referenceQuarter?.replace("Q", "T") ?? "—"}
            </Row>
            <Row label={t("context.revisionMonth")}>{context.revisionMonth ?? "—"}</Row>
            <Row label={t("context.nextRevisionOn")}>
              <DateValue value={context.nextRevisionOn} />
            </Row>
            <Row label={t("context.energyClass")}>{context.energyClass ?? "—"}</Row>
            <Row label={t("context.territory")}>{t(`territoryValue.${context.territory}`)}</Row>
            <Row label={t("context.chargeAmount")}>
              <Money amount={context.chargeAmount} currency={context.currency} />
            </Row>
            <Row label={t("context.seriesSource")}>{context.seriesSource ?? "—"}</Row>
            <Row label={t("context.seriesUpdatedAt")}>
              <DateValue value={context.seriesUpdatedAt} withTime />
            </Row>
          </dl>
          {context.observations.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="series-missing">
              {t("context.seriesMissing")}
            </p>
          ) : null}
        </section>

        <section className="space-y-4 rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold tracking-tight">{t("proposal.title")}</h2>

          {proposal.available ? (
            <dl
              className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,16rem)_1fr]"
              data-testid="revision-proposal"
            >
              <Row label={t("proposal.currentRent")}>
                <Money amount={proposal.currentRent} currency={context.currency} />
              </Row>
              <Row label={t("proposal.newRent")}>
                <Money amount={proposal.newRent} currency={context.currency} />
              </Row>
              <Row label={t("proposal.newRentUnrounded")}>
                <span className="num">{proposal.newRentUnrounded ?? "—"}</span>
              </Row>
              <Row label={t("proposal.increase")}>
                <Money amount={proposal.increase} currency={context.currency} />
              </Row>
              <Row label={t("proposal.baseIndex")}>
                <span className="num">
                  {proposal.baseIndex
                    ? `${proposal.baseIndex.value} (${proposal.baseIndex.period})`
                    : "—"}
                </span>
              </Row>
              <Row label={t("proposal.newIndex")}>
                <span className="num">
                  {proposal.newIndex
                    ? `${proposal.newIndex.value} (${proposal.newIndex.period})`
                    : "—"}
                </span>
              </Row>
              <Row label={t("proposal.effectiveFrom")}>
                <DateValue value={proposal.effectiveFrom} />
              </Row>
            </dl>
          ) : (
            <div
              className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
              data-testid="revision-blocked"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-medium">{t("blockedTitle")}</p>
                <p className="text-muted-foreground">
                  {proposal.blockedReason ? t(`blocked.${proposal.blockedReason}`) : "—"}
                </p>
                {proposal.missing.length > 0 ? (
                  <p className="text-muted-foreground">
                    {t("missingFields", { fields: proposal.missing.join(", ") })}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">{t("proposal.noRetroactivity")}</p>
          <p className="text-sm text-muted-foreground">{t("proposal.preparedHint")}</p>

          {/* Always on screen: a blocked revision answers with its reason. */}
          <Button
            onClick={() => prepare.mutate()}
            disabled={!proposal.available || prepare.isPending}
            data-testid="revision-prepare"
          >
            <TrendingUp aria-hidden="true" />
            {t("proposal.prepare")}
          </Button>
          {prepare.error ? <ErrorBox error={errorPayload(prepare.error)} /> : null}
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold tracking-tight">{t("series.title")}</h2>
          {context.observations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("series.empty")}</p>
          ) : (
            <ScrollRegion label={t("series.title")}>
              <Table>
                <caption className="sr-only">{t("series.title")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t("series.period")}</TableHead>
                    <TableHead scope="col">{t("series.value")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {context.observations.map((observation) => (
                    <TableRow key={observation.period}>
                      <TableCell className="num">{observation.period}</TableCell>
                      <TableCell className="num">{observation.value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          )}
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold tracking-tight">{t("history.title")}</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
          ) : (
            <ScrollRegion label={t("history.title")}>
              <Table>
                <caption className="sr-only">{t("history.title")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t("history.requestedOn")}</TableHead>
                    <TableHead scope="col">{t("history.indices")}</TableHead>
                    <TableHead scope="col">{t("history.baseRent")}</TableHead>
                    <TableHead scope="col">{t("history.proposedRent")}</TableHead>
                    <TableHead scope="col">{t("history.effectiveOn")}</TableHead>
                    <TableHead scope="col">{t("history.status")}</TableHead>
                    <TableHead scope="col">{t("history.letter")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <DateValue value={entry.requestedOn} />
                      </TableCell>
                      <TableCell className="num">
                        {entry.previousIndexValue} → {entry.newIndexValue}
                        <span className="block text-xs text-muted-foreground">
                          {entry.referenceQuarter.replace("Q", "T")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Money amount={entry.baseRent} currency={entry.currency} />
                      </TableCell>
                      <TableCell>
                        <Money amount={entry.proposedRent} currency={entry.currency} />
                        <span className="num block text-xs text-muted-foreground">
                          {entry.computedRentUnrounded}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DateValue value={entry.effectiveOn} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.status === "applied" ? "default" : "outline"}>
                          {t(`statusValue.${entry.status}`)}
                        </Badge>
                        {entry.commandStatus ? (
                          <span className="block text-xs text-muted-foreground">
                            {t("history.command")} : {entry.commandStatus}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={letter.isPending}
                          onClick={() => letter.mutate(entry.id)}
                          data-testid={`revision-letter-${entry.id}`}
                        >
                          <FileText aria-hidden="true" />
                          {entry.letterDocumentId
                            ? t("history.letterReady")
                            : t("history.issueLetter")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          )}
          {letter.error ? <ErrorBox error={errorPayload(letter.error)} /> : null}
        </section>
      </div>
    </>
  );
}
