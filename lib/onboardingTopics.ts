/**
 * Deterministic topic prompts from role + skills (no LLM).
 * Used when the topic recommender returns nothing but we have enough context.
 */
export function generateTopics(role: string, skills: string[]): string[] {
  const r = (role ?? '').trim();
  const sk = (skills ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
  if (!r && sk.length === 0) return [];

  return [
    `Tips for ${r || 'professionals'}`,
    `Best practices in ${sk[0] || 'your field'}`,
    `How to grow in ${r || 'your career'}`,
    `Common mistakes in ${sk[0] || 'industry'}`,
    `Future trends in ${r || 'technology'}`,
  ];
}
