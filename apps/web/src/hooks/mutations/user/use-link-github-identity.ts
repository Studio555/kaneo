import { useMutation, useQueryClient } from "@tanstack/react-query";
import linkGithubIdentity from "@/fetchers/user/link-github-identity";

function useLinkGithubIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: linkGithubIdentity,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["github-identity"] });
    },
  });
}

export default useLinkGithubIdentity;
