// Generates profile-card.svg for a GitHub user. Node 18+, no dependencies.
// Usage: GH_USERNAME=octocat GITHUB_TOKEN=... node scripts/generate-card.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const username = process.env.GH_USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const out = process.env.OUT_FILE || join(here, '..', 'profile-card.svg');
if (!username) throw new Error('Set GH_USERNAME (or run inside GitHub Actions).');

const headers = {
  'User-Agent': 'profile-card-generator',
  Accept: 'application/vnd.github+json',
  ...(token && { Authorization: `Bearer ${token}` }),
};
const api = async (path) => {
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`GitHub API ${path} -> ${r.status}`);
  return r.json();
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- profile
const user = await api(`/users/${username}`);

// ---- repos: stars + languages (own, non-fork repos)
let repos = [];
for (let page = 1; page <= 10; page++) {
  const batch = await api(`/users/${username}/repos?per_page=100&type=owner&page=${page}`);
  repos = repos.concat(batch);
  if (batch.length < 100) break;
}
const own = repos.filter((r) => !r.fork);
const stars = own.reduce((n, r) => n + r.stargazers_count, 0);
const langCount = {};
for (const r of own) if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
const langs = Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l).join(' / ') || 'Open source';

// ---- contributions (last year) via GraphQL; needs a token
let contribs = 0;
if (token) {
  const q = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions}}}}`;
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: q, variables: { login: username } }),
  });
  const j = await r.json();
  contribs = j?.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions ?? 0;
} else {
  console.warn('No GITHUB_TOKEN: contributions will show 0.');
}

// ---- avatar -> data URI (SVGs shown via <img> cannot load external images)
const av = await fetch(`${user.avatar_url}${user.avatar_url.includes('?') ? '&' : '?'}s=96`);
const avatar = `data:${av.headers.get('content-type') || 'image/png'};base64,${Buffer.from(await av.arrayBuffer()).toString('base64')}`;

// ---- name on up to two lines
const fullName = (user.name || user.login).trim();
const words = fullName.split(/\s+/);
let l1 = fullName, l2 = '';
if (words.length > 1) {
  // balance the two lines
  let best = 0, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  l1 = words.slice(0, best).join(' ');
  l2 = words.slice(best).join(' ');
}
const longest = Math.max(l1.length, l2.length, 1);
const nameSize = Math.max(26, Math.min(64, Math.floor(440 / (0.6 * longest))));

const bio = (user.bio || 'On the public internet').replace(/\s+/g, ' ').slice(0, 60);
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

const map = {
  AVATAR: avatar,
  USERNAME: esc(user.login),
  NAME1: esc(l1),
  NAME2: esc(l2),
  NAMESIZE: nameSize,
  LANGS: esc(langs),
  BIO: esc(bio),
  REPOS: fmt(user.public_repos),
  STARS: fmt(stars),
  CONTRIBS: fmt(contribs),
  FOLLOWERS: fmt(user.followers),
};
let svg = readFileSync(join(here, 'template.svg'), 'utf8');
for (const [k, v] of Object.entries(map)) svg = svg.replaceAll(`%%${k}%%`, String(v));
writeFileSync(out, svg);
console.log(`Wrote ${out} for @${user.login}`);
