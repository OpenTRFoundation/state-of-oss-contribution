import yargs, {Argv} from "yargs";

export function getYargs() {
    return yargs(process.argv.slice(2))
        .usage("Usage: $0 [options]")
        .wrap(null)
        .version(false);
}

export function addArguments(y:Argv<any>) {
    return y
        .options({
            "user-count-search-data-directory": {
                type: "string",
                desc: "Path to the user count search data directory.",
                demandOption: true,
            },
            "user-and-contrib-search-data-directory": {
                type: "string",
                desc: "Path to the user and contrib search data directory.",
                demandOption: true,
            },
            "report-data-truth-map-directory": {
                type: "string",
                desc: "Path to the report data truth map directory.",
                demandOption: true,
            },
            "output-directory": {
                type: "string",
                desc: "Path to the output directory.",
                demandOption: true,
            },
        });
}
