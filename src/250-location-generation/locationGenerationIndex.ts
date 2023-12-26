#!/usr/bin/env node

import {GetBuiltOptionsType} from "@opentr/cuttlecat/dist/arguments.js";
import {main} from "./locationGeneration.js";
import {addArguments, getYargs} from "./locationGenerationArguments.js";


(async () => {
    const y = addArguments(getYargs());

    const argv:GetBuiltOptionsType<typeof addArguments> = y.parseSync();

    await main({
        locationsMasterFile: argv.locationsMasterFile,
        locationsAdditionalFile: argv.locationsAdditionalFile,
        locationsExcludeFile: argv.locationsExcludeFile,
        outputFile: argv.outputFile,
    });
})();
