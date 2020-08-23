import * as github from '@actions/github';
import * as readline from 'readline';
import * as core from '@actions/core'
import * as path from 'path';
import * as fs from 'fs';
import {promisify} from "util";

const readFile = promisify(fs.readFile);

export type Conf = {
    srcDirPath: Path
    changelogFilePath: Path
    pageSize: number
    debug: boolean
    ownerAndRepo: string
    token: string
}
export type Path = string;
export type TagName = string;

type GitHubClient = ReturnType<typeof github.getOctokit> & {repoMeta: typeof github.context.repo};

class ValObj<TVal> {
    constructor(public readonly val: TVal) {
    };
}

export abstract class ChangelogHeader extends ValObj<string> {
    public abstract tag(): TagName;
}

export class SemverHeader extends ChangelogHeader {
    public constructor(val: string) {
        const match = SemverHeader.match(val);
        if (!match) {
            throw new Error('Unexpected value');
        }
        super(match.groups!.tag);
    }

    public static match(s: string): null | RegExpMatchArray {
        return s.match(/^#+\s+Version\s+v?(?<tag>[^\s]+)/i)
    }

    public tag(): TagName {
        return 'v' + this.val;
    }
}

export class WeeklyVerHeader extends ChangelogHeader {
    public constructor(val: string) {
        const match = WeeklyVerHeader.match(val);
        if (!match) {
            throw new Error('Unexpected value');
        }
        super(match.groups!.tag);
    }

    public static match(s: string): null | RegExpMatchArray {
        return s.match(/^##\s+Weekly\s+(?<tag>[^\s]+)/i);
    }

    public tag(): TagName {
        // ## Weekly 20200720 (2020-07-20 16:55:47 UTC)
        return 'weekly-' + this.val;
    }
}

export function conf(): Conf {
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

// Taken from TypeScript sources, https://github.com/microsoft/TypeScript
export function memoize<TRes>(callback: () => TRes): () => TRes {
    let value: TRes;
    return () => {
        if (callback) {
            value = callback();
            callback = undefined!;
        }
        return value;
    };
}

export function d(...args: any): never {
    for (const arg of args) {
        console.log(arg);
    }
    const stack = new Error().stack
    if (stack) {
        const chunks = stack.split(/^    at /mg).slice(2)
        console.log("Backtrace:\n" + chunks.join('').replace(/^\s* /mg, '  '));
    }
    process.exit(0);
}

export async function processFileLines<TRes>(filePath: Path, fn: (s: string) => TRes): Promise<any> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    for await (const line of rl) {
        let res = fn(line);
        if (res !== undefined && <Exclude<undefined, any>>res !== false) {
            return res;
        }
    }
}

export function githubClient(): GitHubClient {
    const client = memoize<GitHubClient>(function () {
        const token = conf().token;
        const octokit = github.getOctokit(token);
        return Object.assign(octokit, {repoMeta: github.context.repo});
    });
    return client();
}
