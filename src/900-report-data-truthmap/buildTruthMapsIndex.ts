#!/usr/bin/env node

import {GetBuiltOptionsType} from "@opentr/cuttlecat/dist/arguments.js";
import {main} from "./buildTruthMaps.js";
import {addArguments, getYargs} from "./buildTruthMapsArguments.js";


(async () => {
    const y = addArguments(getYargs());

    const argv:GetBuiltOptionsType<typeof addArguments> = y.parseSync();

    await main({
        focusProjectCandidateSearchDataDirectory: argv.focusProjectCandidateSearchDataDirectory,
        focusProjectExtractDataDirectory: argv.focusProjectExtractDataDirectory,
        focusOrganizationDetailsDataDirectory: argv.focusOrganizationDetailsDataDirectory,
        locationsFilePath: argv.locationsFilePath,
        locationResolutionRulesFilePath: argv.locationResolutionRulesFilePath,
        userAndContribSearchDataDirectory: argv.userAndContribSearchDataDirectory,
        outputDirectory: argv.outputDirectory,
    });
})();
