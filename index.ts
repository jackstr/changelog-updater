import * as core from '@actions/core'
import * as github from '@actions/github';
import {RequestError} from '@octokit/request-error';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {} from "./lib"
import {exec, ExecException} from "child_process";
import {ReposListReleasesResponseData, SearchIssuesAndPullRequestsResponseData} from '@octokit/types'
import * as readline from 'readline';
import {promisify, inspect} from "util";
import compareVersions from 'compare-versions';
import moment from 'moment';
import * as lib from './lib';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

type DateTime = string

type Sha1 = string;
type Tag = {
    name: string
    commit: Sha1
    dateTime: DateTime
    //commits?: Sha1[]
};

type PullReqForChangelogPart = {
    tags: [Tag, Tag]
    issues: Issue[]
}
type PullReqForChangelog = {parts: PullReqForChangelogPart[], text?: string}

type Issue = SearchIssuesAndPullRequestsResponseData['items'][0];
type Release = ReposListReleasesResponseData[0];

type GitHubClient = ReturnType<typeof github.getOctokit> & {repoMeta: typeof github.context.repo};

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
    const client = lib.memoize<GitHubClient>(function () {
        const token = conf().token;
        const octokit = github.getOctokit(token);
        return Object.assign(octokit, {repoMeta: github.context.repo});
    });
    return client();
}

async function* tagIt() {
    const res = await shInSrcDir('git for-each-ref --sort=creatordate --format \'%(refname) %(objectname) %(creatordate)\' refs/tags');

    for (const line of res.lines()) {
        const chunks = line.split(/\s+/)
        const [tagRef, commit, dayOfWeek, month, dayOfMonth, time, year, tzOffset] = chunks
        const dateTime_ = dayOfWeek + ', ' +  dayOfMonth + ' ' +  month + ' ' + year + ' ' + time + ' ' + tzOffset;
        const dateTime = moment(dateTime_).utc().format();
        const match = tagRef.match(/^refs\/tags\/(?<tag>[^\s]+)$/)
        if (!match) {
            throw new Error();
        }
        yield {
            name: match.groups!.tag,
            commit: commit,
            dateTime: dateTime,
        }
    }
}

async function shInSrcDir(cmd: string): Promise<ShRes> {
    return sh('cd ' + shArg(conf().srcDirPath) + '; ' + cmd);
}

function conf(): lib.Conf {
    const changelogFilePath = process.cwd() + '/CHANGELOG.md';
    return {
        changelogFilePath: changelogFilePath,
        srcDirPath: path.dirname(changelogFilePath),
        pageSize: 100,
        debug: true,
        ownerAndRepo: 'jackstr/seamly2d',
        token: <string>(core.getInput('token') || process.env.GITHUB_TOKEN)
    };
}

async function processFileLines<TRes>(filePath: lib.Path, fn: (s: string) => TRes): Promise<any> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity, // NB: we use the crlfDelay option to recognize all instances of CR LF ('\r\n') in input.txt as a single line break.
    });
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
    const tagFromFile = await processFileLines<false | lib.ChangelogHeader | undefined>(conf().changelogFilePath, (line) => {
        if (!line.length) {
            return false;
        }
        if (lib.SemverHeader.match(line)) {
            return new lib.SemverHeader(line);
        }

        if (lib.WeeklyVerHeader.match(line)) {
            return new lib.WeeklyVerHeader(line);
        }

        return false;
    });

    const useTag: (tag: Tag) => boolean = (tag: Tag) => {
        if (tag.name === tagFromFile.tag()) {
            return true;
        }
        if (tagFromFile instanceof lib.SemverHeader) {
            try {
                return compareVersions.compare(tag.name, tagFromFile.tag(), '>=');
            } catch (error) {
                return false;
            }
        }
        if (tagFromFile instanceof lib.WeeklyVerHeader && tag.name.match(/^weekly-\d+$/)) {
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
/*
async function findCommits(startTag: Tag, endTag: Tag) {
    return (await shInSrcDir('git log --pretty=format:"%H" ' + shArg(startTag.name) + '..' + shArg(endTag.name))).lines();
}
*/

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

async function findIssues(startTag: Tag, endTag: Tag): Promise<Issue[]> {
    let issues: Issue[] = [];

    if (conf().debug && fs.existsSync(__dirname + '/issues.json')) {
        issues = require(__dirname + '/issues.json').items;
    } else {
        const startDate = startTag.dateTime;
        const endDate = endTag.dateTime;
        const client = githubClient();
        // https://api.github.com/search/issues?q=repo:FashionFreedom/Seamly2D%20state:closed%20linked:pr%20closed:2020-07-30T13:38:42Z..2020-08-20T23:49:01Z
        // https://docs.github.com/en/github/searching-for-information-on-github/searching-issues-and-pull-requests#search-by-when-an-issue-or-pull-request-was-closed
        const q = `repo:${client.repoMeta.owner}/${client.repoMeta.repo} state:closed linked:pr closed:${startDate}..${endDate}`;
        core.info('Search issues query: ' + q);
        for await (const response of client.paginate.iterator("GET /search/issues", {
            q: q,
            per_page: conf().pageSize,
        })) {
            if (response.data) {
                for (const item of response.data) {

                    if (item.url) {
                        issues.push(item);
                    }
                }
            }
        }
    }

    core.info('Got ' + issues.length + ' issue(s) before filtering: [' + issues.map(issue => issue.number).join(', ') + ']');
    issues = issues.filter(issuesFilter);
    core.info('Got ' + issues.length + ' issue(s) after filtering: [' + issues.map(issue => issue.number).join(', ') + ']');

    return issues;
}

async function preparePullReq(): Promise<PullReqForChangelog | false> {
    const tags = await findTags();
    if (!tags.length) {
        return false;
    }
    tags.push({name: 'HEAD', commit: 'HEAD', dateTime: moment(moment.now()).utc().format()});
    // Now must be at least 2 tags: starting tag and HEAD
    const issues = await findIssues(tags[0], tags[tags.length - 1]);
    const pullReqParts: PullReqForChangelogPart[] = [];

    const issuesMap: {[closedAt: string]: Issue} = {};
    for (const issue of issues) {
        issuesMap[issue.closed_at] = issue;
    }
    const issueDates = Object.keys(issuesMap);

    function findIssuesForTags(startTag: Tag, endTag: Tag): Issue[] {
        const startDate = startTag.dateTime;
        const endDate = endTag.dateTime;
        const issuesForTags: Issue[] = [];
        for (const issueDate of issueDates) {
            if (issueDate >= startDate && issueDate <= endDate) {
                issuesForTags.push(issuesMap[issueDate]);
            }
        }
        return issuesForTags; 
    }
    for (let i = 1; i < tags.length; i++) {
        const startTag = tags[i - 1], endTag = tags[i];
        const issues = findIssuesForTags(startTag, endTag);
        const pullReqPart = {
            tags: <[Tag, Tag]>[startTag, endTag],
            issues: issues
        }
        pullReqParts.push(pullReqPart);
        /*
        const commits = Array.from(await findCommits(startAndEndTags[0], startAndEndTags[1]));
        core.info('Found ' +  commits.length + ' commit(s) from ' + startAndEndTags[0].name + '..' + startAndEndTags[1].name + ': [' + commits.toString().replace(/,/g, ', ') + ']');
        */
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
        newText = pullReq.text!.trim();
        if (newText.length) {
            newText = newText + "\n\n" + oldText;
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
        core.setSecret(conf().token);
        await shInSrcDir('git fetch --tags');
        let pullReq: PullReqForChangelog | false = await preparePullReq();
        if (false !== pullReq) {
            core.info('Modifying the Changelog file');
            pullReq = await renderPullReqText(pullReq);
            await updateChangelogFile(pullReq);
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

main()
