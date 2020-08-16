import * as core from '@actions/core'
import * as github from '@actions/github';
import {RequestError} from '@octokit/request-error';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {exec, ExecException} from "child_process";
import {ReposListReleasesResponseData, SearchIssuesAndPullRequestsResponseData} from '@octokit/types'
import * as readline from 'readline';

type Conf = {
    srcDirPath: Path
    changelogFilePath: Path
    pageSize: number
    debug: boolean
    ownerAndRepo: string
}

type Path = string;
type TagName = string;
type Sha1 = string;
type Tag = {
    name: string
    commit: Sha1
    commits?: Sha1[]
};

type PullReqForChangelogPart = {
    tags: [Tag, Tag]
    issues: Issue[]
}
type PullReqForChangelog = PullReqForChangelogPart[]

type Issue = SearchIssuesAndPullRequestsResponseData['items'][0];
type Release = ReposListReleasesResponseData[0];

type GitHubClient = ReturnType<typeof github.getOctokit> & {repoMeta: typeof github.context.repo};

class ValObj<TVal> {
    constructor(public readonly val: TVal) {
    };
}

abstract class ChangelogHeaderTag extends ValObj<string> {
    public abstract tag(): TagName;
}

class VerHeaderTag extends ChangelogHeaderTag {
    public static match(s: string): null | RegExpMatchArray {
        return s.match(/^#+\s+Version\s+v?(?<tag>[^\s]+)/i)
    }

    public tag(): TagName {
        return 'v' + this.val;
    }
}

class WeeklyHeaderTag extends ChangelogHeaderTag {
    public static match(s: string): null | RegExpMatchArray {
        return s.match(/^##\s+Weekly\s+(?<tag>[^\s]+)/i);
    }

    public tag(): TagName {
        // ## Weekly 20200720 (2020-07-20 16:55:47 UTC)
        return 'weekly-' + this.val;
    }
}

function d(...args: any): void {
    for (const arg of args) {
        console.log(arg);
    }
    const stack = new Error().stack
    if (stack) {
        const chunks = stack.split(/^    at /mg).slice(2)
        console.log("Backtrace:\n" + chunks.join('').replace(/^\s*/mg, '  '));
    }
    process.exit(0);
}

// Taken from TypeScript sources, https://github.com/microsoft/TypeScript
function memoize<TRes>(callback: () => TRes): () => TRes {
    let value: TRes;
    return () => {
        if (callback) {
            value = callback();
            callback = undefined!;
        }
        return value;
    };
}

class ShRes {
    public constructor(
        public stdOut: string,
        public stdErr: string,
        public error?: ExecException
    ) {}

    public* lines() {
        for (let line of this.stdOut.split('\n')) {
            line = line.trim();
            if (line.length) {
                yield line;
            }
        }
    }
}

function shArg(arg: string | number): string {
    arg = String(arg).replace(/[^\\]'/g, function(m, i, s) {
        return m.slice(0, 1) + '\\\'';
    });
    return "'" + arg + "'";
}

type ShConf = {
    lines: boolean
}

async function sh(cmd: string): Promise<ShRes> {
    //const promisifiedExec = util.promisify(exec);
    // const {stdout, stderr} = await promisifiedExec(cmd);
    return new Promise(function (resolve, reject) {
        exec(cmd, function (error, stdOut, stdErr) {
            if (error) {
                reject(new ShRes(stdOut, stdErr, error));
            } else {
                resolve(new ShRes(stdOut, stdErr));
            }
        });
    });
}

async function* releaseIt() {
    // https://octokit.github.io/rest.js/v18
    const client = githubClient();
    for await (const response of client.paginate.iterator(client.repos.listReleases, Object.assign(github.context.repo, {per_page: conf().pageSize}))) {
        if (response.data) {
            for (const k in response.data) {
                yield response.data[k];
            }
        }
    }
}

function githubClient(): GitHubClient {
    const client = memoize<GitHubClient>(function () {
        const myToken = <string>(core.getInput('myToken') || process.env.GITHUB_TOKEN);
        const octokit = github.getOctokit(myToken);
        return Object.assign(octokit, {repoMeta: github.context.repo});
    });
    return client();
}

async function* tagIt() {
    const res = await shInSrcDir('git for-each-ref --sort=creatordate --format \'%(refname) %(objectname) %(creatordate)\' refs/tags');
    const parseTagLine = (line: string): Tag | false => {
        const match = line.match(/refs\/tags\/(?<tag>[^\s]+)\s+(?<commit>[^\s]+)/)
        if (!match) {
            return false;
        }
        const tag = {
            name: match.groups!.tag,
            commit: match.groups!.commit,
        };

        return tag;
    };
    for (const line of res.lines()) {
        const tag = parseTagLine(line);
        if (!tag) {
            continue;
        }
        yield tag;
    }
}

async function shInSrcDir(cmd: string): Promise<ShRes> {
    return sh('cd ' + shArg(conf().srcDirPath) + '; ' + cmd);
}

function conf(): Conf {
    return {
        changelogFilePath: process.cwd() + '/CHANGELOG.md',
        srcDirPath: process.cwd(),
        pageSize: 100,
        debug: true,
        ownerAndRepo: 'jackstr/seamly2d',
    };
}

async function findTags(): Promise<Tag[]> {
    async function processFileLines<TRes>(filePath: Path, fn: (s: string) => TRes): Promise<any> {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });
        // Note: we use the crlfDelay option to recognize all instances of CR LF
        // ('\r\n') in input.txt as a single line break.
        for await (const line of rl) {
            let res = fn(line);
            if (res !== undefined && <Exclude<undefined, any>>res !== false) {
                return res;
            }
        }
    }


    // NB: Changelog file must exist
    const tagFromFile = await processFileLines<false | ChangelogHeaderTag | undefined>(conf().changelogFilePath, (line) => {
        if (!line.length) {
            return false;
        }
        // Old, legacy format
        let match = VerHeaderTag.match(line);
        if (match) {
            return new VerHeaderTag(match.groups!.tag);
        }

        match = WeeklyHeaderTag.match(line);
        if (match) {
            return new WeeklyHeaderTag(match.groups!.tag);
        }

        return false;
    });

    const tags: Tag[] = [];
    let latestTag = null;
    for await (const tag of tagIt()) {
        if (!tagFromFile) {
            latestTag = tag;
        } else if (tag.name === tagFromFile.tag() || tags.length) {  // add tags when the first interesting tag was found.
            tags.push(tag);
        }
    }
    if (!tagFromFile && latestTag) { // tag not found in the file use latest one from repo
        tags.push(latestTag);
    }

    return tags;
}

async function findCommits(startTag: Tag, endTag: Tag) {
    return (await shInSrcDir('git log --pretty=format:"%H" ' + shArg(startTag.name) + '..' + shArg(endTag.name))).lines();
}

async function findIssues(commits: any) {
    const client = githubClient();
    let issues: Issue[] = [];
    if (conf().debug) {
        issues = require(__dirname + '/issues.json').items;
    } else {
        for (const sha1 of commits) {
            const q = `repo:${client.repoMeta.owner}/${client.repoMeta.repo} ${sha1} type:issue state:closed`;
            // https://api.github.com/search/issues?q=repo:jackstr/seamly2d $sha1 type:issue state:closed
            const issuesRes = await client.request('GET /search/issues', {
                q: q,
            })
            if (issuesRes.data.total_count) {
                for (const issue of issuesRes.data.items) {
                    issues.push(issue);
                }
            }
        }
    }
    const havingLabels = (issue: Issue) => {
        const allowedLabels = ['enhancement', 'bug', 'build'];
        for (const label of issue.labels) {
            if (!allowedLabels.includes(label.name)) {
                return false;
            }
        }
        return true;
    };
    return issues.filter(havingLabels);
}

async function preparePullReq(): Promise<PullReqForChangelog | false> {
    const tags = await findTags();
    if (!tags.length) {
        return false;
    }
    tags.push({name: 'HEAD', commit: 'HEAD'});
    const pullReq: PullReqForChangelog = [];
    for (let i = 1; i < tags.length; i++) {
        const tag = tags[i];
        const startAndEndTags: [Tag, Tag] = [tags[i - 1], tags[i]];
        const commits = await findCommits(startAndEndTags[0], startAndEndTags[1]);
        const pullReqPart = {
            tags: startAndEndTags,
            issues: await findIssues(commits)
        }
        pullReq.push(pullReqPart);
    }
    return pullReq;
}

async function sendPullReq(pullReqText: string) {
    //d(pullReqText);
}

function genPullReqText(pullReq: PullReqForChangelog): string {
    let pullReqText = '';
    for (const pullReqPart of pullReq) {
        const [startTag, endTag] = pullReqPart.tags;
        // Ignore starting tag
        pullReqText += '## ' + endTag.name + '\n\n'
        pullReqText += 'foo\n\n';
    }
    return pullReqText.trimRight();
}

async function run() {
    try {
        const pullReq: PullReqForChangelog | false = await preparePullReq();
        if (false !== pullReq) {
            const pullReqText = genPullReqText(pullReq);
            sendPullReq(pullReqText);
        }
    } catch (error) {
        if (conf().debug) {
            console.log(error);
        }
        core.setFailed(error.message);
    }
}

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

run();
