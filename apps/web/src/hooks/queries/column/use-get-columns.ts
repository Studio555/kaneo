import { useQuery } from "@tanstack/react-query";
import getColumns from "@/fetchers/column/get-columns";

/** The project's board columns, or with `kind: "backlog"` its backlog sections. */
export function useGetColumns(
  projectId: string,
  kind: "board" | "backlog" = "board",
) {
  return useQuery({
    // Board columns keep the key they always had, so every existing
    // ["columns", projectId] invalidation still reaches them.
    queryKey:
      kind === "board" ? ["columns", projectId] : ["columns", projectId, kind],
    queryFn: () => getColumns(projectId, kind),
    enabled: !!projectId,
  });
}
