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

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function SignUpForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const organizationName = String(form.get("organizationName") ?? "");
    const slug = slugify(String(form.get("organizationSlug") ?? "") || organizationName);
    setPending(true);
    setError(null);

    const signUp = await authClient.signUp.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      name: String(form.get("fullName") ?? ""),
    });
    if (signUp.error) {
      setPending(false);
      setError({
        code: "VALIDATION",
        message: signUp.error.message ?? "Inscription refusée.",
        requestId: String(signUp.error.code ?? "—"),
      });
      return;
    }

    const organization = await authClient.organization.create({ name: organizationName, slug });
    setPending(false);
    if (organization.error) {
      setError({
        code: "CONFLICT",
        message: organization.error.message ?? "Création de l’organisation refusée.",
        requestId: String(organization.error.code ?? "—"),
      });
      return;
    }
    await authClient.organization.setActive({ organizationId: organization.data.id });
    router.push("/");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <AuthTitle>{t("signUpTitle")}</AuthTitle>
        <CardDescription>{t("signUpDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {error ? <ErrorBox error={error} /> : null}
          <div className="space-y-1.5">
            <Label htmlFor="fullName">{t("fullName")}</Label>
            <Input id="fullName" name="fullName" autoComplete="name" required />
          </div>
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
              autoComplete="new-password"
              minLength={12}
              required
              aria-describedby="password-hint"
            />
            <p id="password-hint" className="text-xs text-muted-foreground">
              {t("passwordHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="organizationName">{t("organizationName")}</Label>
            <Input id="organizationName" name="organizationName" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="organizationSlug">{t("organizationSlug")}</Label>
            <Input
              id="organizationSlug"
              name="organizationSlug"
              required
              aria-describedby="slug-hint"
            />
            <p id="slug-hint" className="text-xs text-muted-foreground">
              {t("organizationSlugHint")}
            </p>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {t("signUp")}
          </Button>
          <p className="text-center text-sm">
            <Link href="/connexion" className="text-primary underline-offset-4 hover:underline">
              {t("toSignIn")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
