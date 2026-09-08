import { useMutation, useQueryClient } from "@tanstack/react-query";
import unlinkGithubIdentity from "@/fetchers/user/unlink-github-identity";

function useUnlinkGithubIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: unlinkGithubIdentity,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["github-identity"] });
    },
  });
}

export default useUnlinkGithubIdentity;
