#!/usr/bin/env node

import {GetBuiltOptionsType} from "@opentr/cuttlecat/dist/arguments.js";
import {main} from "./focusOrgExtract.js";
import {addArguments, getYargs} from "./focusOrgExtractArguments.js";

(async () => {
    const y = addArguments(getYargs());

    const argv:GetBuiltOptionsType<typeof addArguments> = y.parseSync();

    await main({
        focusProjectCandidateSearchDataDirectory: argv.focusProjectCandidateSearchDataDirectory,
        outputDirectory: argv.outputDirectory,
    });
})();
