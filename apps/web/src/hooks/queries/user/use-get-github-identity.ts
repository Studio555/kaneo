import { useQuery } from "@tanstack/react-query";
import getGithubIdentity from "@/fetchers/user/get-github-identity";

function useGetGithubIdentity() {
  return useQuery({
    queryKey: ["github-identity"],
    queryFn: getGithubIdentity,
  });
}

export default useGetGithubIdentity;
