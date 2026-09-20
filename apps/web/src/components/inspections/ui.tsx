"use client";

import type { Inspection, InspectionFindingCondition } from "@lfsci/contracts";
import {
  Archive,
  CircleAlert,
  CircleDashed,
  CircleHelp,
  CloudUpload,
  FilePen,
  FileSignature,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

const STATUS_ICON = {
  draft: FilePen,
  in_progress: CircleDashed,
  pending_sync: CloudUpload,
  signed: FileSignature,
  contested: TriangleAlert,
  archived: Archive,
} as const;

/** Colour never carries the meaning alone: every badge holds an icon and a label. */
export function InspectionStatusBadge({ status }: { status: Inspection["status"] }) {
  const t = useTranslations("inspections.status");
  const Icon = STATUS_ICON[status];
  const variant =
    status === "signed" ? "default" : status === "contested" ? "destructive" : "outline";
  return (
    <Badge variant={variant} className="gap-1" data-testid="inspection-status">
      <Icon aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

const DEGRADED: InspectionFindingCondition[] = ["worn", "damaged", "missing"];

export function ConditionBadge({ condition }: { condition: InspectionFindingCondition | null }) {
  const t = useTranslations("inspections.condition");
  if (condition === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (condition === "not_checked") {
    return (
      <Badge variant="outline" className="gap-1">
        <CircleHelp aria-hidden="true" />
        {t(condition)}
      </Badge>
    );
  }
  return (
    <Badge variant={DEGRADED.includes(condition) ? "destructive" : "secondary"} className="gap-1">
      {DEGRADED.includes(condition) ? <CircleAlert aria-hidden="true" /> : null}
      {t(condition)}
    </Badge>
  );
}
