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
            "files to extract GitHub organizations. For each output file in /path, a focus-organizations-<TIMESTAMP>.json " +
            "file will be generated with the GitHub organizations that are found."
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
            "output-directory": {
                type: "string",
                desc: "Path to output directory. The output files will be named '<TIMESTAMP>/focus-organizations.json'. Timestamps will be taken from the focus candidate project search output file names.",
                demandOption: true,
            },
        });
}
