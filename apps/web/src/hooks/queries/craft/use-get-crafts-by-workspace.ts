import { useQuery } from "@tanstack/react-query";
import getCraftsByWorkspace from "@/fetchers/craft/get-crafts-by-workspace";

function useGetCraftsByWorkspace(workspaceId: string) {
  return useQuery({
    enabled: Boolean(workspaceId),
    queryKey: ["crafts", workspaceId],
    queryFn: () => getCraftsByWorkspace({ workspaceId }),
  });
}

export default useGetCraftsByWorkspace;
