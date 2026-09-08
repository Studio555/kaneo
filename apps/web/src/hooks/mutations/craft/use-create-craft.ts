import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateCraftRequest } from "@/fetchers/craft/create-craft";
import createCraft from "@/fetchers/craft/create-craft";

function useCreateCraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCraft,
    onSuccess: (createdCraft, variables: CreateCraftRequest) => {
      void queryClient.invalidateQueries({
        queryKey: ["crafts", variables.workspaceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["crafts", createdCraft.workspaceId],
      });
    },
  });
}

export default useCreateCraft;
