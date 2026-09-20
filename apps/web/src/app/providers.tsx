"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

type Props = {
  children: React.ReactNode;
  messages: Record<string, unknown>;
  locale: string;
  /** next-themes injects an inline anti-flash script; without this the CSP blocks it. */
  nonce?: string;
};

export function Providers({ children, messages, locale, nonce }: Props) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Paris">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          {...(nonce ? { nonce } : {})}
        >
          <TooltipProvider delay={200}>
            {children}
            <Toaster position="top-right" />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}
