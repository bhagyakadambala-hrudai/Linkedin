/**
 * Best-effort role + skills when LLM extraction is empty (long / structured resumes, API gaps).
 */

const SKILL_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bpower\s*bi\b/i, label: 'Power BI' },
  { re: /\bms\s*excel\b|\bexcel\b/i, label: 'Excel' },
  { re: /\b tableau\b/i, label: 'Tableau' },
  { re: /\blooker\b/i, label: 'Looker' },
  { re: /\bsql\b/i, label: 'SQL' },
  { re: /\bsnowflake\b/i, label: 'Snowflake' },
  { re: /\bpython\b/i, label: 'Python' },
  { re: /\br\b(?![a-z])/i, label: 'R' },
  { re: /\bpandas\b/i, label: 'Pandas' },
  { re: /\bnumpy\b/i, label: 'NumPy' },
  { re: /\bspark\b/i, label: 'Spark' },
  { re: /\betl\b/i, label: 'ETL' },
  { re: /\bairflow\b/i, label: 'Airflow' },
  { re: /\bdbt\b/i, label: 'dbt' },
  { re: /\bmachine learning\b/i, label: 'Machine Learning' },
  { re: /\bdeep learning\b/i, label: 'Deep Learning' },
  { re: /\ba\/b testing\b/i, label: 'A/B Testing' },
  { re: /\bstatistics\b/i, label: 'Statistics' },
  { re: /\bdata analytics\b|\banalytics\b/i, label: 'Data Analytics' },
  { re: /\bjavascript\b/i, label: 'JavaScript' },
  { re: /\btypescript\b/i, label: 'TypeScript' },
  { re: /\bjava\b/i, label: 'Java' },
  { re: /\breact\b/i, label: 'React' },
  { re: /\bnode\.?js\b/i, label: 'Node.js' },
  { re: /\bjava\b/i, label: 'Java' },
  { re: /\baws\b/i, label: 'AWS' },
  { re: /\bazure\b/i, label: 'Azure' },
  { re: /\bgcp\b|\bgoogle cloud\b/i, label: 'Google Cloud' },
  { re: /\bkubernetes\b|\bk8s\b/i, label: 'Kubernetes' },
  { re: /\bdocker\b/i, label: 'Docker' },
  { re: /\bmongodb\b/i, label: 'MongoDB' },
  { re: /\bpostgresql\b|\bpostgres\b/i, label: 'PostgreSQL' },
  { re: /\bmysql\b/i, label: 'MySQL' },
  { re: /\bgraphql\b/i, label: 'GraphQL' },
  { re: /\bagile\b|\bscrum\b/i, label: 'Agile' },
  { re: /\bjira\b/i, label: 'Jira' },
  { re: /\bgithub\b/i, label: 'GitHub' },
  { re: /\bci\/cd\b/i, label: 'CI/CD' },
  { re: /\bhtml\b/i, label: 'HTML' },
  { re: /\bcss\b/i, label: 'CSS' },
  { re: /\bsaas\b/i, label: 'SaaS' },
  { re: /\bsalesforce\b/i, label: 'Salesforce' },
  { re: /\bfigma\b/i, label: 'Figma' },
];

const TITLE_HINT =
  /\b(analyst|analytic|engineer|developer|scientist|architect|manager|lead|director|consultant|specialist|designer|intern|associate|executive|officer|head|founder|vp|ceo|cto|cfo|researcher|strategist|coordinator|administrator|writer|editor)\b/i;

function isNoiseLine(line: string): boolean {
  const l = line.trim();
  if (l.length < 3 || l.length > 95) return true;
  if (/^page\s+\d+/i.test(l)) return true;
  if (/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(l)) return true;
  if (/@|linkedin\.com|github\.com|^www\.|^http/i.test(l)) return true;
  if (/^[+|•\-\u2022]\s*$/.test(l)) return true;
  return false;
}

/**
 * Infer role + skills from raw resume text (no network).
 */
export function inferProfileFromPlainText(text: string): { role: string; skills: string[] } {
  const t = String(text || '').replace(/\r\n/g, '\n');
  const lines = t
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•\u2022]+\s*/, ''))
    .filter((l) => l.length > 0);

  let role = '';
  for (const l of lines.slice(0, 25)) {
    if (isNoiseLine(l)) continue;
    if (TITLE_HINT.test(l)) {
      role = l.slice(0, 90);
      break;
    }
  }
  if (!role) {
    for (const l of lines.slice(0, 8)) {
      if (isNoiseLine(l)) continue;
      if (l.length >= 8 && l.length <= 88) {
        role = l.slice(0, 90);
        break;
      }
    }
  }

  const skills: string[] = [];
  const seen = new Set<string>();
  for (const { re, label } of SKILL_PATTERNS) {
    if (re.test(t)) {
      const key = label.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        skills.push(label);
      }
    }
  }

  const skillsHeader = /(?:^|\n)\s*(?:technical\s+)?skills|core competencies|technologies|tools|expertise/i.exec(t);
  if (skillsHeader && skillsHeader.index != null) {
    const chunk = t.slice(skillsHeader.index, skillsHeader.index + 1200);
    const parts = chunk.split(/[,;|•\n]/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 40);
    for (const p of parts) {
      if (/^skills|^technical|^core|^tools$/i.test(p)) continue;
      const key = p.toLowerCase();
      if (!seen.has(key) && p.split(/\s+/).length <= 4) {
        seen.add(key);
        skills.push(p);
        if (skills.length >= 15) break;
      }
    }
  }

  return { role, skills: skills.slice(0, 15) };
}
