import {readFileSync, writeFileSync} from "fs";
import * as log from "@opentr/cuttlecat/dist/log.js";


const logger = log.createLogger("focusRepositoryExtract/command");

// Extract GitHub orgs from the focus project candidate search results for the repositories that belong to an org.

export interface Config {
    locationsMasterFile:string;
    locationsAdditionalFile:string;
    locationsExcludeFile:string;
    outputFile:string;
}

type LocationsMaster = Array<string>;
type LocationsAdditional = {
    [key:string]:{
        "alternatives":Array<string>,
        "root":boolean | null,
    }
};
type LocationsExclude = Array<string>;
export type LocationsOutputEntry = {
    "text":string,
    "parent":string | null,
    "alternatives":Array<string>,
};
export type LocationsOutput = {
    [key:string]:LocationsOutputEntry;
};

type derivativeFn = (name:string) => string;

export async function main(config:Config) {
    logger.info(`There are ${derivativeSuperSet.length} derivative sets. Each of these sets contain multiple functions that will be applied to a location.`);

    // see the files in test-data folder for the formats of these files examples
    const locationsMasterList:LocationsMaster = JSON.parse(readFileSync(config.locationsMasterFile, "utf8"));
    const locationsAdditionalList:LocationsAdditional = JSON.parse(readFileSync(config.locationsAdditionalFile, "utf8"));
    const locationsExcludeList:LocationsExclude = JSON.parse(readFileSync(config.locationsExcludeFile, "utf8"));

    logger.info(`There are ${locationsMasterList.length} locations in the master list.`);
    logger.info(`There are ${Object.keys(locationsAdditionalList).length} locations in the additional list.`);
    logger.info(`There are ${locationsExcludeList.length} locations in the exclude list.`);

    const output:LocationsOutput = {};
    let root:string = "";

    // root information will be in the additional file, so, process that first
    // find the root location
    for (const name in locationsAdditionalList) {
        if (locationsAdditionalList[name].root) {
            root = name;
            output[name] = {
                text: name,
                parent: null,
                alternatives: [name, ...locationsAdditionalList[name].alternatives],
            };
            break;
        }
    }

    for (const name of locationsMasterList) {
        const parts = name.split(" ");
        if (parts.length != 2) {
            throw new Error(`Invalid location name: "${name}". Location names should have 2 parts, separated by a space`);
        }
        const province = parts[0];
        const district = parts[1];

        if (!output[province]) {
            output[province] = {
                text: province,
                parent: root,
                alternatives: [province],
            }
        } else {
            logger.warn(`Location "${province}" is already in the output list.`);
        }

        if (!output[district]) {
            output[district] = {
                text: district,
                parent: province,
                alternatives: [district],
            }
        } else {
            // let's ignore this case. there are not many districts with the same name, and they don't have many users.
            // also, even if they have users, they will be still matched, but to the wrong province.
            logger.warn(`Location "${district}" is already in the output list.`);
        }
    }

    // process the rest of the locations in additional list
    for (const name in locationsAdditionalList) {
        const location = locationsAdditionalList[name];
        if (location.root) {
            continue;
        }
        if (!output[name]) {
            throw new Error(`Location "${name}" is not in the master list.`);
        }
        output[name].alternatives.push(name, ...location.alternatives);
    }

    // remove excluded locations
    for (const name of locationsExcludeList) {
        if (output[name]) {
            delete output[name];
        }
    }

    // for each entry, generate derivatives for the alternative names (includes the original name)
    for (const name in output) {
        const locationEntry = output[name];
        const newAlternatives:string[] = [...locationEntry.alternatives];
        for (const alternative of locationEntry.alternatives) {
            const derivatives:string[] = generateDerivatives(alternative);
            newAlternatives.push(...derivatives);
        }

        // remove duplicates in alternatives
        locationEntry.alternatives = [...new Set(newAlternatives)];

        // remove excluded locations from alternatives
        locationEntry.alternatives = locationEntry.alternatives.filter((alternative) => {
            return !locationsExcludeList.includes(alternative);
        });
    }

    const alternativeCount = Object.values(output).reduce((acc, location) => acc + location.alternatives.length, 0);
    logger.info(`There are ${Object.keys(output).length} locations in the output list.`);
    logger.info(`There are ${alternativeCount} alternatives in the output list.`);

    // write back the result
    writeFileSync(config.outputFile, JSON.stringify(output, null, 2));
}

const derivativeFunctions:derivativeFn[] = [
    // capital letters
    (text) => {
        return text.replace(/I/g, "İ");
    },
    (text) => {
        return text.replace(/İ/g, "I");
    },
    (text) => {
        return text.replace(/Ö/g, "O");
    },
    (text) => {
        return text.replace(/Ü/g, "U");
    },
    (text) => {
        return text.replace(/Ç/g, "C");
    },
    (text) => {
        return text.replace(/Ş/g, "S");
    },
    (text) => {
        return text.replace(/Ğ/g, "G");
    },
    // small letters
    (text) => {
        return text.replace(/ı/g, "i");
    },
    (text) => {
        return text.replace(/i/g, "ı");
    },
    (text) => {
        return text.replace(/ö/g, "o");
    },
    (text) => {
        return text.replace(/ü/g, "u");
    },
    (text) => {
        return text.replace(/ç/g, "c");
    },
    (text) => {
        return text.replace(/ş/g, "s");
    },
    (text) => {
        return text.replace(/ğ/g, "g");
    },
];

// no idea how this works
// see https://stackoverflow.com/questions/42773836
const derivativeSuperSet = function (theArray) {
    return theArray.reduce(
        (subsets:any, value:any) => subsets.concat(
            subsets.map((set:any) => [value, ...set])
        ),
        [[]]
    );
}(derivativeFunctions);

/**
 * Generate derivatives of a location name.
 * Derivatives are generated by applying a set of functions to the name.
 * For example, for "Çiğli", the following derivatives will be generated:
 * - "Çiğli",
 * - "Ciğli",
 * - "Çığlı",
 * - "Cığlı",
 * - "Çigli",
 * - "Cigli",
 * - "Çıglı",
 * - "Cıglı"
 *
 * @param name
 */
function generateDerivatives(name:string) {
    const derivatives = new Set();

    // derivativeSuperSet is a superset of all possible subsets of derivativeFunctions
    for (const derivativeFunctionSet of derivativeSuperSet) {
        let derivative = name;
        // apply all in a subset of the superset
        for (const derivativeFunction of derivativeFunctionSet) {
            derivative = derivativeFunction(derivative);
        }
        derivatives.add(derivative);
    }

    // if derivative is the same as the original, remove it
    derivatives.delete(name);
    return <string[]>Array.from(derivatives);
}
