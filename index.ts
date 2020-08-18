import * as core from '@actions/core'
import * as github from '@actions/github';
import {RequestError} from '@octokit/request-error';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {exec, ExecException} from "child_process";
import {ReposListReleasesResponseData, SearchIssuesAndPullRequestsResponseData} from '@octokit/types'
import * as readline from 'readline';
import { promisify } from "util";
import compareVersions from 'compare-versions';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

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
type PullReqForChangelog = {parts: PullReqForChangelogPart[], text?: string}

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

function d(...args: any): any {
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
        const token = <string>(core.getInput('token') || process.env.GITHUB_TOKEN);
        const octokit = github.getOctokit(token);
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
    const changelogFilePath = process.cwd() + '/CHANGELOG.md';
    return {
        changelogFilePath: changelogFilePath,
        srcDirPath: path.dirname(changelogFilePath),
        pageSize: 100,
        debug: !process.env.GITHUB_ACTION,
        ownerAndRepo: 'jackstr/seamly2d',
    };
}

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

function tagsFilter(tag: Tag): boolean {
    return (isVerTag(tag.name) || isWeeklyTag(tag.name)) && !tag.name.match(/\btest\b/);
}

async function findTags(): Promise<Tag[]> {
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

    const useTag: (tag: Tag) => boolean = (tag: Tag) => {
        if (tag.name === tagFromFile.tag()) {
            return true;
        }
        if (tagFromFile instanceof VerHeaderTag) {
            try {
                return compareVersions.compare(tag.name, tagFromFile.tag(), '>=');
            } catch (error) {
                return false;
            }
        }
        if (tagFromFile instanceof WeeklyHeaderTag && tag.name.match(/^weekly-\d+$/)) {
            return tag.name >= tagFromFile.tag();
        }

        return false;
    };

    core.info('Found tag in the Changelog file: ' + tagFromFile.val);

    let tags: Tag[] = [];
    let latestTag = null;
    for await (const tag of tagIt()) {
        if (!tagFromFile) {
            latestTag = tag;
        } else if (!tags.length && useTag(tag)) {  // add tags when the first interesting tag was found.
            tags.push(tag);
        } else if (tags.length) { // first tag found
            tags.push(tag);
        }
    }
    if (!tagFromFile && latestTag) { // tag not found in the file use latest one from repo
        tags.push(latestTag);
    }

    tags = tags.filter(tagsFilter);

    core.info('Found ' + tags.length + ' tag(s): [' + tags.map(tag => tag.name).join(', ') + ']')

    return tags;
}

async function findCommits(startTag: Tag, endTag: Tag) {
    return (await shInSrcDir('git log --pretty=format:"%H" ' + shArg(startTag.name) + '..' + shArg(endTag.name))).lines();
}

function issuesFilter(issue: Issue): boolean {
    const havingLabels = (issue: Issue) => {
        const allowedLabels = ['enhancement', 'bug', 'build'];
        for (const label of issue.labels) {
            if (!allowedLabels.includes(label.name)) {
                return false;
            }
        }
        return true;
    };
    return havingLabels(issue);
}

async function findIssues(commits: any): Promise<Issue[]> {
    let issues: Issue[] = [];
    if (fs.existsSync(__dirname + '/issues.json')) { // used for testing
        issues = require(__dirname + '/issues.json').items;
    } else {
        const client = githubClient();
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

    issues = issues.filter(issuesFilter);

    core.info('Found ' + issues.length + ' issue(s): [' + issues.map(issue => issue.number).join(', ') + ']');

    return issues;
}

async function preparePullReq(): Promise<PullReqForChangelog | false> {
    const tags = await findTags();
    if (!tags.length) {
        return false;
    }
    tags.push({name: 'HEAD', commit: 'HEAD'});
    const pullReqParts: PullReqForChangelogPart[] = [];
    for (let i = 1; i < tags.length; i++) {
        const tag = tags[i];
        const startAndEndTags: [Tag, Tag] = [tags[i - 1], tags[i]];
        const commits = Array.from(await findCommits(startAndEndTags[0], startAndEndTags[1]));
        core.info('Found ' +  commits.length + ' commit(s): ' + commits.toString().replace(/,/g, ', '));
        const pullReqPart = {
            tags: startAndEndTags,
            issues: await findIssues(commits)
        }
        pullReqParts.push(pullReqPart);
    }
    return {
        parts: pullReqParts.reverse()
    }
}

async function updateChangelogFile(pullReq: PullReqForChangelog) {
    const changelogFilePath = conf().changelogFilePath;
    let newText = '';
    if (fs.existsSync(changelogFilePath)) {
        const oldText = await readFile(changelogFilePath, 'utf8');
        let newText = pullReq.text!.trim();
        if (newText.length) {
            newText + "\n\n" + oldText;
        }
    } else {
        newText = pullReq.text!.trim();
    }
    if (newText.length) {
        await writeFile(changelogFilePath, newText);
    }
}

function isVerTag(tagName: string): boolean {
    return !!tagName.match(/^v\d+\.\d+\.\d+/);
}

function isWeeklyTag(tagName: string): boolean {
    return tagName.startsWith('weekly-');
}

async function renderPullReqText(pullReq: PullReqForChangelog): Promise<PullReqForChangelog> {
    function incTagVersion(tagName: string): string {
        const match = tagName.match(/(?<before>.*\b)(?<ver>\d+)(?<after>\b.*)/)
        if (match) {
            return match.groups!.before + (Number(match.groups!.ver) + 1) + match.groups!.after;
        }
        return tagName;
    }

    function renderTagName(tagName: string, prevVer: string | null): string {
        if (tagName === 'HEAD') {
            return renderTagName(incTagVersion(<string>prevVer), null);
        }
        if (isVerTag(tagName)) {
            return 'Version ' + tagName;
        }
        if (isWeeklyTag(tagName)) {
            return 'Weekly ' + tagName.substr(tagName.indexOf('-') + 1)
        }
        return tagName;
    }

    async function findPrevVer() {
        let prevVer = null;
        for (const pullReqPart of pullReq.parts) {
            const [startTag, endTag] = pullReqPart.tags;
            if (isVerTag(startTag.name)) {
                prevVer = startTag.name;
                break;
            }
        }
        if (null === prevVer) {
            for await (const tag of tagIt()) {
                if (isVerTag(tag.name)) {
                    prevVer = tag.name;
                }
            }
        }
        if (null === prevVer) {
            prevVer = 'v0.0.1';
        }
        return prevVer;
    }

    const prevVer = await findPrevVer();
    let pullReqText = '';
    for (const pullReqPart of pullReq.parts) {
        const [startTag, endTag] = pullReqPart.tags;
        if (pullReqPart.issues.length) {
            pullReqText += (pullReqText.length ? "\n" : "") + '## ' + renderTagName(endTag.name, prevVer) + '\n\n'
            for (const issue of pullReqPart.issues) {
                pullReqText += '* [#' + issue.number + '](' + issue.html_url + ') ' + issue.title.trimEnd() + "\n";
            }
        }
    }
    pullReq.text = pullReqText.length ? pullReqText.trimEnd() + "\n" : '';
    return pullReq;
}

async function main() {
    try {
        await shInSrcDir('git fetch --tags');
        let pullReq: PullReqForChangelog | false = await preparePullReq();
        if (false !== pullReq) {
            core.info('Modifying the Changelog file');
            pullReq = await renderPullReqText(pullReq);
            updateChangelogFile(pullReq);
        } else {
            core.info('Ignoring modification of the Changelog file');
        }
    } catch (error) {
        if (conf().debug) {
            console.log(error);
        }
        core.setFailed(error.message);
    }
}
/*
process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
*/

main();
