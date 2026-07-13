/**
 * src/utils/investor-word-export.ts — PATCH 7
 * Export Word du rapport investisseur (optionnel).
 *
 * Appelle /api/llm/generate-word avec le rapport structuré.
 * Le serveur génère le .docx et le renvoie en base64.
 * Le client le télécharge.
 */
export async function generateInvestorWordReport(
  report: any,
  baseResult: any,
): Promise<void> {
  const res = await fetch('/api/llm/generate-word', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, baseResult }),
  });
  if (!res.ok) throw new Error('Génération Word échouée');
  const { base64, filename } = await res.json();
  const blob = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
