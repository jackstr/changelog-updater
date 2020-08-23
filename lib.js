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
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.githubClient = exports.processFileLines = exports.d = exports.memoize = exports.conf = exports.WeeklyVerHeader = exports.SemverHeader = exports.ChangelogHeader = void 0;
const github = __importStar(require("@actions/github"));
const readline = __importStar(require("readline"));
const core = __importStar(require("@actions/core"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const util_1 = require("util");
const readFile = util_1.promisify(fs.readFile);
class ValObj {
    constructor(val) {
        this.val = val;
    }
    ;
}
class ChangelogHeader extends ValObj {
}
exports.ChangelogHeader = ChangelogHeader;
class SemverHeader extends ChangelogHeader {
    constructor(val) {
        const match = SemverHeader.match(val);
        if (!match) {
            throw new Error('Unexpected value');
        }
        super(match.groups.tag);
    }
    static match(s) {
        return s.match(/^#+\s+Version\s+v?(?<tag>[^\s]+)/i);
    }
    tag() {
        return 'v' + this.val;
    }
}
exports.SemverHeader = SemverHeader;
class WeeklyVerHeader extends ChangelogHeader {
    constructor(val) {
        const match = WeeklyVerHeader.match(val);
        if (!match) {
            throw new Error('Unexpected value');
        }
        super(match.groups.tag);
    }
    static match(s) {
        return s.match(/^##\s+Weekly\s+(?<tag>[^\s]+)/i);
    }
    tag() {
        // ## Weekly 20200720 (2020-07-20 16:55:47 UTC)
        return 'weekly-' + this.val;
    }
}
exports.WeeklyVerHeader = WeeklyVerHeader;
function conf() {
    const changelogFilePath = process.cwd() + '/CHANGELOG.md';
    return {
        changelogFilePath: changelogFilePath,
        srcDirPath: path.dirname(changelogFilePath),
        pageSize: 100,
        debug: true,
        ownerAndRepo: 'jackstr/seamly2d',
        token: (core.getInput('token') || process.env.GITHUB_TOKEN)
    };
}
exports.conf = conf;
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
exports.memoize = memoize;
function d(...args) {
    for (const arg of args) {
        console.log(arg);
    }
    const stack = new Error().stack;
    if (stack) {
        const chunks = stack.split(/^    at /mg).slice(2);
        console.log("Backtrace:\n" + chunks.join('').replace(/^\s* /mg, '  '));
    }
    process.exit(0);
}
exports.d = d;
async function processFileLines(filePath, fn) {
    var e_1, _a;
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    try {
        for (var rl_1 = __asyncValues(rl), rl_1_1; rl_1_1 = await rl_1.next(), !rl_1_1.done;) {
            const line = rl_1_1.value;
            let res = fn(line);
            if (res !== undefined && res !== false) {
                return res;
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (rl_1_1 && !rl_1_1.done && (_a = rl_1.return)) await _a.call(rl_1);
        }
        finally { if (e_1) throw e_1.error; }
    }
}
exports.processFileLines = processFileLines;
function githubClient() {
    const client = memoize(function () {
        const token = conf().token;
        const octokit = github.getOctokit(token);
        return Object.assign(octokit, { repoMeta: github.context.repo });
    });
    return client();
}
exports.githubClient = githubClient;
//# sourceMappingURL=lib.js.map