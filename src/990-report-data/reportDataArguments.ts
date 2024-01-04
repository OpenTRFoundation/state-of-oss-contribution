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
