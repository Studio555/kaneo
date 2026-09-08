import { Badge } from "@/components/ui/badge";
import { resolveLabelColor } from "@/lib/label-color";
import type { TaskCraft as TaskCraftValue } from "@/types/task";

export function TaskCraft({ craft }: { craft: TaskCraftValue | null }) {
  if (!craft) return null;

  return (
    <Badge
      variant="outline"
      className="max-w-full min-w-0 px-2 py-0.5 text-[10px] flex items-center"
    >
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 mr-1 shrink-0 rounded-full"
        style={{ backgroundColor: resolveLabelColor(craft.color) }}
      />
      <span className="min-w-0 truncate" title={craft.name}>
        {craft.name}
      </span>
    </Badge>
  );
}
