"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i;
    function verb(n) { if (g[n]) i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const readline = __importStar(require("readline"));
const util_1 = require("util");
const compare_versions_1 = __importDefault(require("compare-versions"));
const writeFile = util_1.promisify(fs.writeFile);
const readFile = util_1.promisify(fs.readFile);
class ValObj {
    constructor(val) {
        this.val = val;
    }
    ;
}
class ChangelogHeaderTag extends ValObj {
}
class VerHeaderTag extends ChangelogHeaderTag {
    static match(s) {
        return s.match(/^#+\s+Version\s+v?(?<tag>[^\s]+)/i);
    }
    tag() {
        return 'v' + this.val;
    }
}
class WeeklyHeaderTag extends ChangelogHeaderTag {
    static match(s) {
        return s.match(/^##\s+Weekly\s+(?<tag>[^\s]+)/i);
    }
    tag() {
        // ## Weekly 20200720 (2020-07-20 16:55:47 UTC)
        return 'weekly-' + this.val;
    }
}
function d(...args) {
    for (const arg of args) {
        console.log(arg);
    }
    const stack = new Error().stack;
    if (stack) {
        const chunks = stack.split(/^    at /mg).slice(2);
        console.log("Backtrace:\n" + chunks.join('').replace(/^\s*/mg, '  '));
    }
    process.exit(0);
}
// Taken from TypeScript sources, https://github.com/microsoft/TypeScript
function memoize(callback) {
    let value;
    return () => {
        if (callback) {
            value = callback();
            callback = undefined;
        }
        return value;
    };
}
class ShRes {
    constructor(stdOut, stdErr, error) {
        this.stdOut = stdOut;
        this.stdErr = stdErr;
        this.error = error;
    }
    *lines() {
        for (let line of this.stdOut.split('\n')) {
            line = line.trim();
            if (line.length) {
                yield line;
            }
        }
    }
}
function shArg(arg) {
    arg = String(arg).replace(/[^\\]'/g, function (m, i, s) {
        return m.slice(0, 1) + '\\\'';
    });
    return "'" + arg + "'";
}
async function sh(cmd) {
    //const promisifiedExec = util.promisify(exec);
    // const {stdout, stderr} = await promisifiedExec(cmd);
    return new Promise(function (resolve, reject) {
        child_process_1.exec(cmd, function (error, stdOut, stdErr) {
            if (error) {
                reject(new ShRes(stdOut, stdErr, error));
            }
            else {
                resolve(new ShRes(stdOut, stdErr));
            }
        });
    });
}
function releaseIt() {
    return __asyncGenerator(this, arguments, function* releaseIt_1() {
        var e_1, _a;
        // https://octokit.github.io/rest.js/v18
        const client = githubClient();
        try {
            for (var _b = __asyncValues(client.paginate.iterator(client.repos.listReleases, Object.assign(github.context.repo, { per_page: conf().pageSize }))), _c; _c = yield __await(_b.next()), !_c.done;) {
                const response = _c.value;
                if (response.data) {
                    for (const k in response.data) {
                        yield yield __await(response.data[k]);
                    }
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) yield __await(_a.call(_b));
            }
            finally { if (e_1) throw e_1.error; }
        }
    });
}
function githubClient() {
    const client = memoize(function () {
        const myToken = (core.getInput('myToken') || process.env.GITHUB_TOKEN);
        const octokit = github.getOctokit(myToken);
        return Object.assign(octokit, { repoMeta: github.context.repo });
    });
    return client();
}
function tagIt() {
    return __asyncGenerator(this, arguments, function* tagIt_1() {
        const res = yield __await(shInSrcDir('git for-each-ref --sort=creatordate --format \'%(refname) %(objectname) %(creatordate)\' refs/tags'));
        const parseTagLine = (line) => {
            const match = line.match(/refs\/tags\/(?<tag>[^\s]+)\s+(?<commit>[^\s]+)/);
            if (!match) {
                return false;
            }
            const tag = {
                name: match.groups.tag,
                commit: match.groups.commit,
            };
            return tag;
        };
        for (const line of res.lines()) {
            const tag = parseTagLine(line);
            if (!tag) {
                continue;
            }
            yield yield __await(tag);
        }
    });
}
async function shInSrcDir(cmd) {
    return sh('cd ' + shArg(conf().srcDirPath) + '; ' + cmd);
}
function conf() {
    return {
        changelogFilePath: process.cwd() + '/CHANGELOG.md',
        srcDirPath: process.cwd(),
        pageSize: 100,
        debug: !process.env.GITHUB_ACTION,
        ownerAndRepo: 'jackstr/seamly2d',
    };
}
async function processFileLines(filePath, fn) {
    var e_2, _a;
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    try {
        // Note: we use the crlfDelay option to recognize all instances of CR LF
        // ('\r\n') in input.txt as a single line break.
        for (var rl_1 = __asyncValues(rl), rl_1_1; rl_1_1 = await rl_1.next(), !rl_1_1.done;) {
            const line = rl_1_1.value;
            let res = fn(line);
            if (res !== undefined && res !== false) {
                return res;
            }
        }
    }
    catch (e_2_1) { e_2 = { error: e_2_1 }; }
    finally {
        try {
            if (rl_1_1 && !rl_1_1.done && (_a = rl_1.return)) await _a.call(rl_1);
        }
        finally { if (e_2) throw e_2.error; }
    }
}
async function findTags() {
    var e_3, _a;
    // NB: Changelog file must exist
    const tagFromFile = await processFileLines(conf().changelogFilePath, (line) => {
        if (!line.length) {
            return false;
        }
        // Old, legacy format
        let match = VerHeaderTag.match(line);
        if (match) {
            return new VerHeaderTag(match.groups.tag);
        }
        match = WeeklyHeaderTag.match(line);
        if (match) {
            return new WeeklyHeaderTag(match.groups.tag);
        }
        return false;
    });
    const useTag = (tag) => {
        if (tag.name === tagFromFile.tag()) {
            return true;
        }
        if (tagFromFile instanceof VerHeaderTag) {
            try {
                return compare_versions_1.default.compare(tag.name, tagFromFile.tag(), '>=');
            }
            catch (error) {
                return false;
            }
        }
        if (tagFromFile instanceof WeeklyHeaderTag && tag.name.match(/^weekly-\d+$/)) {
            return tag.name >= tagFromFile.tag();
        }
        return false;
    };
    core.info('Found tag in the Changelog: ' + tagFromFile.val);
    const tags = [];
    let latestTag = null;
    try {
        for (var _b = __asyncValues(tagIt()), _c; _c = await _b.next(), !_c.done;) {
            const tag = _c.value;
            if (!tagFromFile) {
                latestTag = tag;
            }
            else if (!tags.length && useTag(tag)) { // add tags when the first interesting tag was found.
                tags.push(tag);
            }
            else if (tags.length) { // first tag found
                tags.push(tag);
            }
        }
    }
    catch (e_3_1) { e_3 = { error: e_3_1 }; }
    finally {
        try {
            if (_c && !_c.done && (_a = _b.return)) await _a.call(_b);
        }
        finally { if (e_3) throw e_3.error; }
    }
    if (!tagFromFile && latestTag) { // tag not found in the file use latest one from repo
        tags.push(latestTag);
    }
    return tags;
}
async function findCommits(startTag, endTag) {
    return (await shInSrcDir('git log --pretty=format:"%H" ' + shArg(startTag.name) + '..' + shArg(endTag.name))).lines();
}
async function findIssues(commits) {
    let issues = [];
    if (fs.existsSync(__dirname + '/issues.json')) { // used for testing
        core.info('Using issues.json file');
        issues = require(__dirname + '/issues.json').items;
    }
    else {
        core.info('Checking issues using REST API...');
        const client = githubClient();
        for (const sha1 of commits) {
            const q = `repo:${client.repoMeta.owner}/${client.repoMeta.repo} ${sha1} type:issue state:closed`;
            // https://api.github.com/search/issues?q=repo:jackstr/seamly2d $sha1 type:issue state:closed
            const issuesRes = await client.request('GET /search/issues', {
                q: q,
            });
            if (issuesRes.data.total_count) {
                for (const issue of issuesRes.data.items) {
                    issues.push(issue);
                }
            }
        }
        core.info('Found issues: ' + issues.length);
    }
    const havingLabels = (issue) => {
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
async function preparePullReq() {
    const tags = await findTags();
    if (!tags.length) {
        return false;
    }
    tags.push({ name: 'HEAD', commit: 'HEAD' });
    const pullReqParts = [];
    for (let i = 1; i < tags.length; i++) {
        const tag = tags[i];
        const startAndEndTags = [tags[i - 1], tags[i]];
        const commits = await findCommits(startAndEndTags[0], startAndEndTags[1]);
        const pullReqPart = {
            tags: startAndEndTags,
            issues: await findIssues(commits)
        };
        pullReqParts.push(pullReqPart);
    }
    return {
        parts: pullReqParts.reverse()
    };
}
async function changeChangelogFile(pullReq) {
    const changelogFilePath = conf().changelogFilePath;
    if (fs.existsSync(changelogFilePath)) {
        const oldText = await readFile(changelogFilePath, 'utf8');
        const newText = pullReq.text.trim() + "\n\n" + oldText;
        await writeFile(changelogFilePath, newText);
    }
    else {
        await writeFile(changelogFilePath, pullReq.text.trim());
    }
}
function isVerTag(tagName) {
    return !!tagName.match(/^v\d+\.\d+\.\d+$/);
}
function isWeeklyTag(tagName) {
    return tagName.startsWith('weekly-');
}
async function renderPullReqText(pullReq) {
    function incTagVersion(tagName) {
        const parts = tagName.split('.');
        const lastPart = Number(parts.pop()) + 1;
        parts.push(lastPart + '');
        return parts.join('.');
    }
    function renderTagName(tagName, prevVer) {
        if (tagName === 'HEAD') {
            return renderTagName(incTagVersion(prevVer), null);
        }
        if (isVerTag(tagName)) {
            return 'Version ' + tagName;
        }
        if (isWeeklyTag(tagName)) {
            return 'Weekly ' + tagName.substr(tagName.indexOf('-') + 1);
        }
        return tagName;
    }
    async function findPrevVer() {
        var e_4, _a;
        let prevVer = null;
        for (const pullReqPart of pullReq.parts) {
            const [startTag, endTag] = pullReqPart.tags;
            if (isVerTag(startTag.name)) {
                prevVer = startTag.name;
                break;
            }
        }
        if (null === prevVer) {
            try {
                for (var _b = __asyncValues(tagIt()), _c; _c = await _b.next(), !_c.done;) {
                    const tag = _c.value;
                    if (isVerTag(tag.name)) {
                        prevVer = tag.name;
                    }
                }
            }
            catch (e_4_1) { e_4 = { error: e_4_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) await _a.call(_b);
                }
                finally { if (e_4) throw e_4.error; }
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
        // Ignore starting tag
        pullReqText += (pullReqText.length ? "\n" : "") + '## ' + renderTagName(endTag.name, prevVer) + '\n\n';
        for (const issue of pullReqPart.issues) {
            pullReqText += '* [#' + issue.number + '] ' + issue.title.trimEnd() + "\n";
        }
    }
    pullReq.text = pullReqText.trimEnd() + "\n";
    return pullReq;
}
async function main() {
    try {
        const shD = async (cmd) => {
            core.info(cmd);
            console.log(await sh(cmd));
        };
        // todo
        core.info('DEBUG start');
        core.startGroup('DEBUG');
        await shD('echo $SHELL; echo $PATH');
        await shD('which -a pwd; which -a ls; which -a git');
        await shD('echo $BASH_VERSION; echo $PWD');
        await shD('pwd && ls -alR && git tag -l');
        process.exit(2);
        core.endGroup();
        /*
        
                let pullReq: PullReqForChangelog | false = await preparePullReq();
                if (false !== pullReq) {
                    core.info('Modifying the Changelog file');
                    pullReq = await renderPullReqText(pullReq);
                    changeChangelogFile(pullReq);
                } else {
                    core.info('Ignoring modification of the Changelog file');
                }
                */
    }
    catch (error) {
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
//# sourceMappingURL=index.js.map