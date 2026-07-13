import { fetchGitHubData } from '../../server/services/githubExtractor';

export async function fetchGitHub(org: string | null) {
  if (!org) return null;
  return fetchGitHubData(org, org); // owner=org, repo=org par défaut
}
