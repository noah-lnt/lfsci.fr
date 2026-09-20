"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { AuthTitle } from "../auth-title";

export function SignOut() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void authClient.signOut().then(() => {
      if (cancelled) return;
      setDone(true);
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <Card>
      <CardHeader>
        <AuthTitle>{done ? t("signedOut") : t("signingOut")}</AuthTitle>
      </CardHeader>
      <CardContent>
        <Link href="/connexion" className="text-sm text-primary underline-offset-4 hover:underline">
          {t("backToSignIn")}
        </Link>
      </CardContent>
    </Card>
  );
}
