"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { AuthTitle } from "../auth-title";

export function SignInForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (result.error) {
      setError({
        code: "UNAUTHENTICATED",
        message: t("invalidCredentials"),
        requestId: String(result.error.code ?? "—"),
      });
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <AuthTitle>{t("signInTitle")}</AuthTitle>
        <CardDescription>{t("signInDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {error ? <ErrorBox error={error} /> : null}
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {t("signIn")}
          </Button>
          <p className="text-center text-sm">
            <Link href="/inscription" className="text-primary underline-offset-4 hover:underline">
              {t("toSignUp")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
