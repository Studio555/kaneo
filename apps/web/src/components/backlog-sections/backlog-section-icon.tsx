import { Archive, Clock, Layers } from "lucide-react";
import type { BacklogSection } from "@/types/project";

/** Planned and Archived keep their long-standing icons; custom sections share one. */
export function BacklogSectionIcon({
  section,
  className,
}: {
  section: Pick<BacklogSection, "systemKey">;
  className?: string;
}) {
  if (section.systemKey === "planned") return <Clock className={className} />;
  if (section.systemKey === "archived")
    return <Archive className={className} />;
  return <Layers className={className} />;
}
