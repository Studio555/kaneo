/** GitHub owner and repository names are case-insensitive. */
export function sameRepository(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function repositoryFullName(owner: string, name: string): string {
  return `${owner}/${name}`;
}
