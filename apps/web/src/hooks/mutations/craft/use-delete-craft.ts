import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteCraft from "@/fetchers/craft/delete-craft";

function useDeleteCraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCraft,
    onSuccess: (deletedCraft) => {
      void queryClient.invalidateQueries({
        queryKey: ["crafts", deletedCraft.workspaceId],
      });
      // Tasks that carried the craft are now uncrafted.
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task"] });
    },
  });
}

export default useDeleteCraft;
