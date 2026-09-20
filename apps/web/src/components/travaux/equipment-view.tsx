"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { TextField } from "@/components/finance/fields";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { errorPayload, rpc } from "@/lib/rpc";

export function EquipmentView() {
  const t = useTranslations("travaux.equipment");
  const tForm = useTranslations("travaux.equipment.form");
  const tStatus = useTranslations("travaux.status");
  const queryClient = useQueryClient();

  const [category, setCategory] = useState("");
  const [label, setLabel] = useState("");
  const [brand, setBrand] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const equipment = useQuery({
    queryKey: ["travaux", "equipment"],
    queryFn: () => rpc.travaux.equipment.list({ limit: 50 }),
  });

  const create = useMutation({
    mutationFn: () =>
      rpc.travaux.equipment.create({
        category,
        label,
        ...(brand ? { brand } : {}),
        ...(serialNumber ? { serialNumber } : {}),
        ...(warrantyUntil ? { warrantyUntil } : {}),
      }),
    onSuccess: async () => {
      setError(null);
      setCategory("");
      setLabel("");
      setBrand("");
      setSerialNumber("");
      setWarrantyUntil("");
      await queryClient.invalidateQueries({ queryKey: ["travaux", "equipment"] });
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  if (equipment.isError) return <ErrorBox error={errorPayload(equipment.error)} />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("assetNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          {equipment.isPending ? <Skeleton className="h-32 w-full" /> : null}
          {equipment.data && equipment.data.items.length === 0 ? (
            <EmptyState title={t("title")}>{t("empty")}</EmptyState>
          ) : null}
          {equipment.data && equipment.data.items.length > 0 ? (
            <ScrollRegion label={t("title")}>
              <Table>
                <caption className="sr-only">{t("title")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t("columns.label")}</TableHead>
                    <TableHead scope="col">{t("columns.category")}</TableHead>
                    <TableHead scope="col">{t("columns.brand")}</TableHead>
                    <TableHead scope="col">{t("columns.serial")}</TableHead>
                    <TableHead scope="col">{t("columns.supplier")}</TableHead>
                    <TableHead scope="col">{t("columns.warranty")}</TableHead>
                    <TableHead scope="col">{t("columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.data.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.label}</TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell>{item.brand ?? "—"}</TableCell>
                      <TableCell className="num">{item.serialNumber ?? "—"}</TableCell>
                      <TableCell>{item.supplierName ?? "—"}</TableCell>
                      <TableCell>
                        <DateValue value={item.warrantyUntil} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{tStatus(item.status)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tForm("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              create.mutate();
            }}
          >
            {error ? <ErrorBox error={error} /> : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label={tForm("label")} value={label} onChange={setLabel} />
              <TextField label={tForm("category")} value={category} onChange={setCategory} />
              <TextField label={tForm("brand")} value={brand} onChange={setBrand} />
              <TextField
                label={tForm("serialNumber")}
                value={serialNumber}
                onChange={setSerialNumber}
              />
              <TextField
                label={tForm("warrantyUntil")}
                type="date"
                value={warrantyUntil}
                onChange={setWarrantyUntil}
              />
            </div>
            <Button type="submit" disabled={label === "" || category === "" || create.isPending}>
              {create.isPending ? tForm("submitting") : tForm("submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
