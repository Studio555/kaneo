import { client } from "@kaneo/libs";

async function unlinkGithubIdentity() {
  const response = await client.user["github-identity"].$delete();

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export default unlinkGithubIdentity;
