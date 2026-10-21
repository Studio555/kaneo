import { useQuery } from "@tanstack/react-query";
import getColumns from "@/fetchers/column/get-columns";

type ColumnQueryOptions = {
  /** `"backlog"` returns the project's backlog sections instead of its board columns. */
  kind?: "board" | "backlog";
  refreshOnMount?: boolean;
  refreshWhileVisible?: boolean;
};

export function useGetColumns(
  projectId: string,
  options: ColumnQueryOptions = {},
) {
  const kind = options.kind ?? "board";
  return useQuery({
    // Board columns keep the key they always had, so every existing
    // ["columns", projectId] invalidation still reaches them.
    queryKey:
      kind === "board" ? ["columns", projectId] : ["columns", projectId, kind],
    queryFn: () => getColumns(projectId, kind),
    enabled: !!projectId,
    ...(options.refreshOnMount || options.refreshWhileVisible
      ? {
          refetchOnMount: "always" as const,
          refetchOnWindowFocus: "always" as const,
        }
      : {}),
    ...(options.refreshWhileVisible ? { refetchInterval: 30_000 } : {}),
  });
}
