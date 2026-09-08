import { client } from "@kaneo/libs";

async function linkGithubIdentity({ login }: { login: string }) {
  const response = await client.user["github-identity"].$put({
    json: { login },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export default linkGithubIdentity;
