"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { errorPayload, rpc } from "@/lib/rpc";
import { encode, QUIET_ZONE, toSvgPath } from "./qr";

type Enrolment = { totpURI: string; backupCodes: string[] };

function secretOf(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  const secret = match?.[1] ?? "";
  return (secret.match(/.{1,4}/g) ?? []).join(" ");
}

function QrCode({ value, label }: { value: string; label: string }) {
  const matrix = useMemo(() => encode(value), [value]);
  const span = matrix.size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${span} ${span}`}
      className="size-56 rounded-lg bg-white p-2"
    >
      <title>{label}</title>
      <g transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`} fill="#000">
        <path d={toSvgPath(matrix)} />
      </g>
    </svg>
  );
}

function BackupCodes({ codes, title, hint }: { codes: string[]; title: string; hint: string }) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="text-muted-foreground text-sm">{hint}</p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3">
        {codes.map((code) => (
          <li key={code} className="rounded-md bg-muted px-2 py-1">
            {code}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SecuriteView() {
  const t = useTranslations("parametres.securite");
  const queryClient = useQueryClient();
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["parametres", "securite"],
    queryFn: () => rpc.parametres.securite(),
  });

  const refresh = async (message: string): Promise<void> => {
    setNotice(message);
    await queryClient.invalidateQueries({ queryKey: ["parametres", "securite"] });
  };

  const fail = (message: string) => {
    setError({ code: "UNAUTHENTICATED", message, requestId: "—" });
  };

  const enable = useMutation({
    mutationFn: async (password: string) => authClient.twoFactor.enable({ password }),
    onSuccess: (result) => {
      if (result.error || !result.data || !("totpURI" in result.data)) {
        fail(t("invalidPassword"));
        return;
      }
      setError(null);
      setNotice(null);
      setEnrolment({ totpURI: result.data.totpURI, backupCodes: result.data.backupCodes });
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const verify = useMutation({
    mutationFn: async (code: string) => authClient.twoFactor.verifyTotp({ code }),
    onSuccess: async (result) => {
      if (result.error) {
        fail(t("invalidCode"));
        return;
      }
      setError(null);
      setEnrolment(null);
      await refresh(t("enabled"));
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const regenerate = useMutation({
    mutationFn: async (password: string) => authClient.twoFactor.generateBackupCodes({ password }),
    onSuccess: async (result) => {
      if (result.error || !result.data) {
        fail(t("invalidPassword"));
        return;
      }
      setError(null);
      setFreshCodes(result.data.backupCodes);
      await refresh(t("regenerated"));
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const disable = useMutation({
    mutationFn: async (password: string) => authClient.twoFactor.disable({ password }),
    onSuccess: async (result) => {
      if (result.error) {
        fail(t("invalidPassword"));
        return;
      }
      setError(null);
      setFreshCodes(null);
      await refresh(t("disabled"));
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const submitPassword = (
    event: React.FormEvent<HTMLFormElement>,
    run: (password: string) => void,
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run(String(form.get("password") ?? ""));
  };

  const enabled = status.data?.twoFactorEnabled ?? false;

  return (
    <div className="space-y-6">
      {error ? <ErrorBox error={error} /> : null}
      {notice ? (
        <p className="flex items-center gap-2 text-sm" role="status">
          <Check className="size-4 text-primary" aria-hidden="true" />
          {notice}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-lg">{t("title")}</h2>
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? (
                <ShieldCheck className="size-3.5" aria-hidden="true" />
              ) : (
                <ShieldOff className="size-3.5" aria-hidden="true" />
              )}
              {enabled ? t("statusOn") : t("statusOff")}
            </Badge>
          </div>
          <CardDescription>{t("statusHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">{t("account")} : </span>
            {status.data?.email ?? "—"}
          </p>
          <p className="text-muted-foreground">
            {status.data?.hasBackupCodes ? t("backupPresent") : t("backupAbsent")}
          </p>
        </CardContent>
      </Card>

      {!enabled && !enrolment ? (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-lg">{t("enableTitle")}</h2>
            <CardDescription>{t("enableHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => submitPassword(event, (password) => enable.mutate(password))}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="enable-password">{t("password")}</Label>
                <Input
                  id="enable-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" disabled={enable.isPending}>
                {t("enable")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {enrolment ? (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-lg">{t("verifyTitle")}</h2>
            <CardDescription>{t("verifyHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-start gap-6">
              <QrCode value={enrolment.totpURI} label={t("scanAlt")} />
              <div className="space-y-2">
                <p className="text-sm">{t("scan")}</p>
                <p className="text-muted-foreground text-sm">{t("manualKey")}</p>
                <p className="select-all font-mono text-sm tracking-wider">
                  {secretOf(enrolment.totpURI)}
                </p>
              </div>
            </div>

            <BackupCodes
              codes={enrolment.backupCodes}
              title={t("backupTitle")}
              hint={t("backupHint")}
            />

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                verify.mutate(String(form.get("code") ?? ""));
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="totp-code">{t("code")}</Label>
                <Input
                  id="totp-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </div>
              <Button type="submit" disabled={verify.isPending}>
                {t("verify")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {enabled ? (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-lg">{t("backupTitle")}</h2>
            <CardDescription>{t("backupHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {freshCodes ? (
              <BackupCodes codes={freshCodes} title={t("backupTitle")} hint={t("regenerated")} />
            ) : null}
            <form
              onSubmit={(event) => submitPassword(event, (password) => regenerate.mutate(password))}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="regenerate-password">{t("password")}</Label>
                <Input
                  id="regenerate-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" variant="secondary" disabled={regenerate.isPending}>
                {t("regenerate")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {enabled ? (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-lg">{t("disableTitle")}</h2>
            <CardDescription>{t("disableHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => submitPassword(event, (password) => disable.mutate(password))}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="disable-password">{t("password")}</Label>
                <Input
                  id="disable-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" variant="destructive" disabled={disable.isPending}>
                {t("disable")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-lg">{t("passkeyTitle")}</h2>
          <CardDescription>{t("passkeyUnavailable")}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
