/*
 * Cross-repo ordering gate. A PR whose body says it depends on a PR in an
 * upstream repo stays blocked until that PR's merge commit is contained in the
 * commit the upstream records as running in production.
 */

const COMMENT = /<!--[\s\S]*?(-->|$)/g;
const HEADING = /^\s{0,3}#{1,6}\s/;
const OPENER = /\b(depends\s+on|blocked\s+by)\b/i;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const lines = (body) => String(body ?? '').replace(COMMENT, '').replace(/\r\n?/g, '\n').split('\n');

/* `owner/repo#N`, `repo#N` or a github.com pull/issues URL. Issue numbers fail later as "not a pull request". */
function refPattern(upstreamRepo) {
  const [owner, name] = upstreamRepo.split('/').map(escape);
  return new RegExp(
    `(?:^|[^\\w./-])(?:${owner}/)?${name}#(\\d+)\\b|https?://github\\.com/${owner}/${name}/(?:pull|issues)/(\\d+)\\b`,
    'gi',
  );
}

const refsIn = (line, re) => [...line.matchAll(re)].map((m) => Number(m[1] ?? m[2]));
const sorted = (set) => [...set].sort((a, b) => a - b);

/*
 * Upstream PR numbers named in "Depends on" / "Blocked by" blocks, sorted and unique.
 * A heading containing the phrase opens a block that runs to the next heading. Any
 * other line containing it opens one that runs to the next heading or two blank lines
 * in a row, so a blank line before a list and wrapped list items stay inside.
 */
export function parseDependsOn(body, upstreamRepo) {
  const re = refPattern(upstreamRepo);
  const found = new Set();
  let block = null; // 'heading' | 'paragraph' | null
  let blanks = 0;
  for (const line of lines(body)) {
    const heading = HEADING.test(line);
    blanks = line.trim() === '' ? blanks + 1 : 0;
    if (heading || (block === 'paragraph' && blanks >= 2)) block = null;
    if (OPENER.test(line)) block = heading ? 'heading' : (block ?? 'paragraph');
    if (block) for (const n of refsIn(line, re)) found.add(n);
  }
  return sorted(found);
}

/* Every upstream reference in the body, inside a block or not (comments excluded). */
export function mentionedRefs(body, upstreamRepo) {
  const re = refPattern(upstreamRepo);
  return sorted(new Set(lines(body).flatMap((l) => refsIn(l, re))));
}

const COMMIT = /^[0-9a-f]{40}$/;

/*
 * Every commit a detailed /health report says production runs: the web process and
 * each worker process (pricing runs only on the worker). Throws on anything it
 * cannot vouch for, so the recorder never moves the ref on a partial report.
 */
export function healthCommits(report) {
  const web = report?.service;
  const workers = report?.workers;
  if (!web || !workers) throw new Error('not a detailed /health report (token missing or rejected?)');
  if (!web.valid || !COMMIT.test(String(web.commit))) throw new Error('web service reports no valid commit');
  if (!workers.ok || !(workers.count > 0) || !Array.isArray(workers.processes) || !workers.processes.length) {
    throw new Error('worker report is missing or empty');
  }
  const bad = workers.processes.filter((p) => !p?.valid || !COMMIT.test(String(p.commit)));
  if (bad.length) throw new Error(`${bad.length} worker process(es) report no valid commit`);
  return [...new Set([web.commit, ...workers.processes.map((p) => p.commit)])];
}

/* The commit every other one contains: what all of production runs at least. Throws when they diverge. */
export function pickOldest(commits, contains) {
  const oldest = commits.find((c) => commits.every((o) => o === c || contains(c, o)));
  if (!oldest) throw new Error(`production processes run diverged commits: ${commits.map((c) => c.slice(0, 7)).join(', ')}`);
  return oldest;
}

/*
 * Why upstream PR `pr` (null when the number is not a PR) does not count yet, or null when it does.
 * pending: waiting fixes it. failure: only editing the body fixes it.
 * deployedSha undefined: no deployed ref configured, the branch is the target; null: configured but missing.
 */
function blocker(pr, { branch, deployedSha, contains }) {
  if (!pr) return ['failure', 'is not a pull request'];
  if (!pr.merged) return pr.state === 'open' ? ['pending', 'is not merged yet'] : ['failure', 'was closed without merging'];
  if (!pr.merge_commit_sha) return ['failure', 'is merged but has no merge commit'];
  if (!contains(pr.merge_commit_sha, branch)) return ['pending', `is merged but not on ${branch} yet (promote dev with a merge commit)`];
  if (deployedSha === undefined) return null;
  if (!deployedSha) return ['pending', `is on ${branch}; the production commit is unknown`];
  if (!contains(pr.merge_commit_sha, deployedSha)) return ['pending', `is on ${branch} but not running in production yet`];
  return null;
}

/*
 * The status for a PR that depends on upstream PRs `deps`.
 * getPr(n): the upstream PR's REST json, or null on 404. contains(sha, ref): sha is an ancestor of (or is) ref.
 * getPr null means no upstream access. API errors other than 404 throw: the job goes red, no verdict is posted.
 */
export function evaluateDeps({ deps, mentioned = [], repo, branch, deployedSha, getPr, contains }) {
  if (!deps.length) {
    const note = mentioned.length ? `; mentions #${mentioned.join(', #')} outside "Depends on"` : '';
    return { state: 'success', description: `no ${repo} dependency${note}` };
  }
  if (!getPr || !contains) return { state: 'failure', description: `cannot read ${repo} to check #${deps.join(', #')} (no token)` };
  const blocked = deps
    .map((n) => [n, blocker(getPr(n), { branch, deployedSha, contains })])
    .filter(([, why]) => why);
  if (!blocked.length) {
    const refs = `${repo}#${deps.join(', #')}`;
    if (deployedSha === undefined) return { state: 'success', description: `${refs} ${deps.length > 1 ? 'are' : 'is'} on ${branch}` };
    return { state: 'success', description: `${refs} ${deps.length > 1 ? 'run' : 'runs'} in production` };
  }
  const worst = blocked.find(([, [state]]) => state === 'failure') ?? blocked[0];
  const more = blocked.length > 1 ? ` (+${blocked.length - 1} more)` : '';
  return { state: worst[1][0], description: `${repo}#${worst[0]} ${worst[1][1]}${more}` };
}

export const DEPENDS_ON_CONTEXT = 'harness/depends-on';

/*
 * Evaluates and posts the status for each PR ({number, headSha, body}). Skips a post that
 * would repeat the newest one. If the deployed branch moved while this ran, runs once more,
 * so a slow run never leaves a verdict made against an older production commit.
 * upstream null: no access (token missing). Returns the number of PRs that errored.
 */
export function gatePrs({
  prs, upstreamRepo, branch, deployedBranch, upstream, currentStatus, post, refresh, log = console.log,
}) {
  const readDeployed = () => (deployedBranch ? (upstream ? upstream.branchSha(deployedBranch) : null) : undefined);
  let errors = 0;
  let deployedSha = readDeployed();
  for (let pass = 0; pass < 2; pass += 1) {
    errors = 0;
    for (const listed of prs) {
      try {
        /* refresh(pr): the PR as it is now, null when closed. Re-read before judging and again before
           posting, so a run never overwrites the verdict on a body edited meanwhile; that edit's own run owns it. */
        const pr = refresh ? refresh(listed) : listed;
        if (!pr) continue;
        const deps = parseDependsOn(pr.body, upstreamRepo);
        const mentioned = mentionedRefs(pr.body, upstreamRepo).filter((n) => !deps.includes(n));
        const { state, description } = evaluateDeps({
          deps, mentioned, repo: upstreamRepo, branch, deployedSha, getPr: upstream?.getPr, contains: upstream?.contains,
        });
        const desc = description.slice(0, 140);
        const again = refresh ? refresh(listed) : pr;
        if (!again || again.headSha !== pr.headSha || again.body !== pr.body) {
          log(`#${pr.number} changed while checking; left to its own run`);
          continue;
        }
        const now = currentStatus(pr.headSha);
        if (now?.state !== state || now?.description !== desc) post(pr.headSha, state, desc);
        log(`#${pr.number} ${state}: ${desc}`);
      } catch (err) {
        errors += 1;
        log(`ERROR: #${listed.number}: ${String(err?.message ?? err).split('\n')[0]}`);
      }
    }
    const again = readDeployed();
    if (again === deployedSha) break;
    log(`NOTE: ${deployedBranch} moved during the run; re-checking`);
    deployedSha = again;
  }
  return errors;
}

/*
 * Reads what production runs and moves `deployedBranch` there.
 * readHealth(): the detailed /health json. api: upstreamApi for this repo.
 * setBranch(sha, exists): force-moves (or creates) the branch.
 * waitFor: a sha every production process must contain before recording, polled until deadline.
 * On timeout it records what runs anyway and reports timedOut, so the caller can fail the job.
 */
export async function recordDeployed({
  readHealth, api, setBranch, branch, deployedBranch = 'deployed/production',
  waitFor = '', deadline = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log,
}) {
  let commits;
  let timedOut = false;
  for (;;) {
    try {
      commits = healthCommits(await readHealth());
      if (!waitFor || commits.every((c) => api.contains(waitFor, c))) break;
      log(`waiting: production runs ${commits.map((c) => c.slice(0, 7)).join(', ')}, want ${waitFor.slice(0, 7)}`);
    } catch (err) {
      if (!waitFor) throw err;
      commits = null;
      log(`waiting: ${String(err?.message ?? err).split('\n')[0]}`);
    }
    if (Date.now() >= deadline) {
      timedOut = true;
      if (!commits) commits = healthCommits(await readHealth());
      break;
    }
    await sleep(30_000);
  }
  const sha = pickOldest(commits, api.contains);
  if (!api.contains(sha, branch)) throw new Error(`production runs ${sha.slice(0, 7)}, which is not on ${branch}; not recording it`);
  const current = api.branchSha(deployedBranch);
  if (current === sha) return { sha, moved: false, timedOut };
  setBranch(sha, current !== null);
  return { sha, moved: true, timedOut };
}

const is404 =(err) => /HTTP 404/.test(`${err?.stderr ?? ''} ${err?.message ?? ''}`);

/* Read-only upstream lookups over `gh api` (exec = gh with an upstream-capable GH_TOKEN). */
export function upstreamApi(repo, exec) {
  const or404 = (fn) => {
    try {
      return fn();
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  };
  return {
    getPr: (n) => or404(() => JSON.parse(exec('api', `repos/${repo}/pulls/${n}`))),
    /* compare/{base}...{head} is "ahead" or "identical" exactly when base is an ancestor of head. Errors: not contained. */
    contains: (sha, target) => {
      try {
        return ['ahead', 'identical'].includes(exec('api', `repos/${repo}/compare/${sha}...${target}`, '--jq', '.status').trim());
      } catch {
        return false;
      }
    },
    branchSha: (branch) => or404(() => exec('api', `repos/${repo}/git/ref/heads/${branch}`, '--jq', '.object.sha').trim()),
  };
}
