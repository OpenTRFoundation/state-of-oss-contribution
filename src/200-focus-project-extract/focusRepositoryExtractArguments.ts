import yargs, {Argv} from "yargs";

export function getYargs() {
    return yargs(process.argv.slice(2))
        .usage("Usage: $0 [options]")
        .wrap(null)
        .version(false);
}

export function addArguments(y:Argv<any>) {
    return y
        .example(
            "--focus-project-candidate-search-data-directory=/path",
            "When focus-project-candidate-search is run and it produced output files to /path, this command will use those " +
            "files to extract GitHub repositories that **do not belong to a GitHub organization** and match the criteria. " +
            "For each output file in /path, a focus-repositories-<TIMESTAMP>.json file will be generated with the GitHub repositories."
        )
        .example(
            "--exclude-list-file=/path/to/exclude-list.json",
            "Path to the exclude list file. This file should be a JSON array of repository full names (owner/repo). " +
            "Even though some repositories may match the criteria, they are not really open source projects. This option allows " +
            "you to exclude those repositories from the output."
        )
        .example(
            "--min-stars=500 --min-forks=300 --min-mentionable-users=200 --min-pull-requests=500",
            "Minimum number of stars, forks, mentionable users, and pull requests for a repository to be considered."
        )
        .options({
            "focus-project-candidate-search-data-directory": {
                type: "string",
                desc: "Path of the directory that holds focus project candidate search files.",
                demandOption: true,
            },
            "exclude-list-file": {
                type: "string",
                desc: "Path to the exclude list file.",
                demandOption: true,
            },
            "output-directory": {
                type: "string",
                desc: "Path to output directory. The output files will be named '<TIMESTAMP>/focus-repositories.json'. Timestamps will be taken from the focus candidate project search output file names.",
                demandOption: true,
            },
            "min-stars": {
                type: "number",
                desc: "Minimum number of stars for a repository to be considered.",
                default: 500,
            },
            "min-forks": {
                type: "number",
                desc: "Minimum number of forks for a repository to be considered.",
                default: 300,
            },
            "min-mentionable-users": {
                type: "number",
                desc: "Minimum number of mentionable users for a repository to be considered.",
                default: 200,
            },
            "min-pull-requests": {
                type: "number",
                desc: "Minimum number of pull requests for a repository to be considered.",
                default: 500,
            },
        });
}
