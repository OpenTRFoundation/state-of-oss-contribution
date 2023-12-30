#!/usr/bin/env node

import {GetBuiltOptionsType} from "@opentr/cuttlecat/dist/arguments.js";
import {main} from "./debugData.js";
import {addArguments, getYargs} from "./debugDataArguments.js";


(async () => {
    const y = addArguments(getYargs());

    const argv:GetBuiltOptionsType<typeof addArguments> = y.parseSync();

    await main({
        userCountSearchDataDirectory: argv.userCountSearchDataDirectory,
        userAndContribSearchDataDirectory: argv.userAndContribSearchDataDirectory,
        reportDataTruthMapDirectory: argv.reportDataTruthMapDirectory,
        outputDirectory: argv.outputDirectory,
    });
})();
