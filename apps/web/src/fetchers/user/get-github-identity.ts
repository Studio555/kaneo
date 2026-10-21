import { client } from "@kaneo/libs";

async function getGithubIdentity() {
  const response = await client.user["github-identity"].$get();

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export default getGithubIdentity;
