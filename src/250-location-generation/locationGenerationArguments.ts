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
            "locations-master-file": {
                type: "string",
                desc: "Path to the master locations file.",
                demandOption: true,
            },
            "locations-additional-file": {
                type: "string",
                desc: "Path to the additional locations file.",
                demandOption: true,
            },
            "locations-exclude-file": {
                type: "string",
                desc: "Path to the file that contains locations to exclude.",
                demandOption: true,
            },
            "output-file": {
                type: "string",
                desc: "Path to the output file.",
                demandOption: true,
            },
        });
}
