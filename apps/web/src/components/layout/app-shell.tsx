"use client";

import { useState } from "react";
import { Header, type HeaderUser } from "./header";
import { Sidebar } from "./sidebar";

type Props = {
  user: HeaderUser;
  showAdmin: boolean;
  assistant?: React.ReactNode;
  children: React.ReactNode;
};

export function AppShell({ user, showAdmin, assistant, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        showAdmin={showAdmin}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} showAdmin={showAdmin} assistant={assistant} />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="page-fade-in space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
