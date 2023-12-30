import * as fs from "fs";
import {join} from "path";
import {TaskRunOutputItem} from "@opentr/cuttlecat/dist/graphql/taskRunOutputItem.js";

import {ProcessFileHelper} from "@opentr/cuttlecat/dist/processFileHelper.js";
import {ProcessState} from "@opentr/cuttlecat/dist/subcommand/execute.js";

import {readSlurpJsonFileSync} from "@opentr/cuttlecat/dist/utils.js";
import {UserAndContribSearchTaskSpec} from "../400-user-and-contrib-search/userAndContribSearch.js";

const UnknownProvince = "-Unknown-";

export interface Config {
    userCountSearchDataDirectory:string;
    userAndContribSearchDataDirectory:string;
    reportDataTruthMapDirectory:string;
    outputDirectory:string;
}

export async function main(config:Config) {
    const userCountPerLocationSearchTermMap = buildUserCountPerLocationSearchTermMap(config);
    const locationStringPerLocationSearchTermMap = buildLocationStringPerLocationSearchTermMap(config);
    const resolvedUserLocationStringsPerProvinceMap = buildResolvedUserLocationStringsPerProvinceMap(config);


    fs.writeFileSync(join(config.outputDirectory, "100-user-count-per-location-search-term.json"), JSON.stringify(userCountPerLocationSearchTermMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "200-location-string-per-location-search-term.json"), JSON.stringify(locationStringPerLocationSearchTermMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "300-resolved-user-location-strings-per-province.json"), JSON.stringify(resolvedUserLocationStringsPerProvinceMap, null, 2));
}

/**
 * Reads the output from the user count per location search data and builds a map of the user count per location search term.
 * Example:
 * - Turkey: 12345
 * - Turkiye: 1234
 * - Istanbul: 123
 * - Ankara: 12
 * @param config
 */
function buildUserCountPerLocationSearchTermMap(config:Config) {
    const userCountSearchFileHelper = new ProcessFileHelper(config.userCountSearchDataDirectory);
    const latestProcessStateDirectory = userCountSearchFileHelper.getLatestProcessStateDirectory();
    if (!latestProcessStateDirectory) {
        throw new Error("No latest process state directory found");
    }

    const processStateFilePath = userCountSearchFileHelper.getProcessStateFilePath(latestProcessStateDirectory);

    const processState:ProcessState = JSON.parse(fs.readFileSync(processStateFilePath, "utf8"));

    let processOutputFiles = userCountSearchFileHelper.getProcessOutputFiles(latestProcessStateDirectory);
    // add directory path to file names
    processOutputFiles = processOutputFiles.map((processOutputFile) => join(config.userCountSearchDataDirectory, latestProcessStateDirectory, processOutputFile));

    const output:{ [location:string]:number } = {};
    for (const processOutputFile of processOutputFiles) {
        const processOutput:TaskRunOutputItem[] = readSlurpJsonFileSync(processOutputFile);
        for (const fileOutput of processOutput) {
            if (processState.archived[fileOutput.taskId]) {
                // the output was found in an archived task, let's discard the output.
                continue;
            }
            const location = fileOutput.result.location;
            const userCount = fileOutput.result.userCount;

            // discard the location if the user count is 0
            if (!userCount) {
                continue;
            }

            output[location] = userCount;
        }
    }

    // sort the output by user count
    const outputEntries = Object.entries(output);
    outputEntries.sort((a, b) => b[1] - a[1]);
    const sortedOutput:{ [location:string]:number } = {};
    for (const outputEntry of outputEntries) {
        sortedOutput[outputEntry[0]] = outputEntry[1];
    }
    return sortedOutput;
}

/**
 * Reads the output from user and contrib search to build a map of information for location search term.
 *
 * Example map:
 * - Turkey:
 *     userCount: 62794,
 *     foundLocationStrings:
 *       - İstanbul / TURKEY
 *       - Ankara, Turkey
 * - Istanbul:
 *     userCount: 46127,
 *     foundLocationStrings:
 *       - Istanbul,
 *       - Kartal,İstanbul
 * @param config
 */
function buildLocationStringPerLocationSearchTermMap(config:Config) {
    const userAndContribSearchFileHelper = new ProcessFileHelper(config.userAndContribSearchDataDirectory);
    const latestProcessStateDirectory = userAndContribSearchFileHelper.getLatestProcessStateDirectory();
    if (!latestProcessStateDirectory) {
        throw new Error("No latest process state directory found");
    }

    const processStateFilePath = userAndContribSearchFileHelper.getProcessStateFilePath(latestProcessStateDirectory);

    const processState:ProcessState = JSON.parse(fs.readFileSync(processStateFilePath, "utf8"));

    let processOutputFiles = userAndContribSearchFileHelper.getProcessOutputFiles(latestProcessStateDirectory);
    // add directory path to file names
    processOutputFiles = processOutputFiles.map((processOutputFile) => join(config.userAndContribSearchDataDirectory, latestProcessStateDirectory, processOutputFile));

    const output:{ [location:string]:{ userCount:number, foundLocationStrings:string[] } } = {};
    for (const processOutputFile of processOutputFiles) {
        const processOutput:TaskRunOutputItem[] = readSlurpJsonFileSync(processOutputFile);
        for (const fileOutput of processOutput) {
            if (processState.archived[fileOutput.taskId]) {
                // the output was found in an archived task, let's discard the output.
                continue;
            }

            // sample fileOutput entry:
            // {"taskId":"d1d07c75-8d62-45fd-a975-a9352d8d064f","result":{"login":"...","company":null,"name":"...","location":"Istanbul, Türkiye",...}

            // sample task entry;
            // {"id": "a0f99bae-1b5a-4936-9a43-93b8844efa5f","location": "Istanbul",...}

            const location = fileOutput.result.location;
            const taskSpec = processState.resolved[fileOutput.taskId].task as UserAndContribSearchTaskSpec;
            const locationTerm = taskSpec.location;

            if (!output[locationTerm]) {
                output[locationTerm] = {
                    userCount: 0,
                    foundLocationStrings: [],
                };
            }

            output[locationTerm].userCount++;
            output[locationTerm].foundLocationStrings.push(location);
        }
    }

    // sort the output by user count
    const outputEntries = Object.entries(output);
    outputEntries.sort((a, b) => b[1].userCount - a[1].userCount);
    const sortedOutput:{ [location:string]:{ userCount:number, foundLocationStrings:string[] } } = {};
    for (const outputEntry of outputEntries) {
        sortedOutput[outputEntry[0]] = outputEntry[1];
        const foundLocationStrings = outputEntry[1].foundLocationStrings
        // deduplicate the found location strings
        outputEntry[1].foundLocationStrings = [...new Set(foundLocationStrings)];
        // sort the found location strings by length
        outputEntry[1].foundLocationStrings.sort((a, b) => a.length - b.length);
    }
    return sortedOutput;
}

/**
 * Reads the output from the user location truth map and builds a map of the resolved user location strings per province.
 *
 * Example map:
 * - Istanbul:
 *    - Istanbul
 *    - İstanbul / TURKEY
 *    - Kartal,İstanbul
 * - Ankara:
 *   - Ankara, Turkey
 *   - Ankara
 * - -Unknown-:
 *   - turkey
 *   - TR
 *
 * @param config
 */
function buildResolvedUserLocationStringsPerProvinceMap(config:Config) {
    // 1. read the output from 900-report-data-truthmap/truth-map-user-locations.json file
    // 2. for each user, get the resolved province
    // 3. add the user entered location string to the resolved province entry

    const truthMapUserLocationsFilePath = join(config.reportDataTruthMapDirectory, "truth-map-user-locations.json");
    const truthMapUserLocations:{[username:string]:{province:string, enteredLocation:string}} = JSON.parse(fs.readFileSync(truthMapUserLocationsFilePath, "utf8"));

    const output:{[province:string]:string[]} = {};

    // entries:
    // "user1": {
    //     "province": null,
    //     "locationSearchBucket": "Turkey",
    //     "enteredLocation": "turkey ",
    //     "allLocationSearchBuckets": [
    //       "Turkey"
    //     ]
    //   },
    //   "user2": {
    //     "province": "Ankara",
    //     "locationSearchBucket": "Ankara",
    //     "enteredLocation": "Ankara",
    //     "allLocationSearchBuckets": [
    //       "Ankara"
    //     ]
    //   },
    for (const username in truthMapUserLocations) {
        const userLocation = truthMapUserLocations[username];

        // DEBUG
        // if(username !== "user1" && username !== "user2") {
        //     continue;
        // }

        if(!userLocation){
            // it is possible that the user has no location data.
            continue;
        }

        let province = userLocation.province;
        if (!province) {
            province = UnknownProvince;
        }

        // DEBUG
        // if(province === UnknownProvince) {
        //     console.log(`User ${_username} has unknown province, entered location: ${userLocation.enteredLocation}`);
        // }

        if (!output[province]) {
            output[province] = [];
        }

        output[province].push(userLocation.enteredLocation);
        // deduplicate the found location strings
        output[province] = [...new Set(output[province])];
    }

    // sort the output by number of user location strings
    const outputEntries = Object.entries(output);
    outputEntries.sort((a, b) => b[1].length - a[1].length);
    const sortedOutput:{[province:string]:string[]} = {};
    for (const outputEntry of outputEntries) {
        sortedOutput[outputEntry[0]] = outputEntry[1];
        // sort the found location strings by length
        outputEntry[1].sort((a, b) => a.length - b.length);
    }

    return sortedOutput;
}
