import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateCraft from "@/fetchers/craft/update-craft";

function useUpdateCraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCraft,
    onSuccess: (updatedCraft) => {
      void queryClient.invalidateQueries({
        queryKey: ["crafts", updatedCraft.workspaceId],
      });
      // A renamed craft is embedded in every board task that carries it, so
      // the board data is stale even though no task row changed.
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task"] });
    },
  });
}

export default useUpdateCraft;
