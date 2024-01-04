#!/usr/bin/env node

import {GetBuiltOptionsType} from "@opentr/cuttlecat/dist/arguments.js";
import {main} from "./reportData.js";
import {addArguments, getYargs} from "./reportDataArguments.js";


(async () => {
    const y = addArguments(getYargs());

    const argv:GetBuiltOptionsType<typeof addArguments> = y.parseSync();

    await main({
        reportDataTruthMapDirectory: argv.reportDataTruthMapDirectory,
        outputDirectory: argv.outputDirectory,
    });
})();
