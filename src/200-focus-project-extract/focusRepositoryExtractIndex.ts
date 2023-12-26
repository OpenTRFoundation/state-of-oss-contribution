#!/usr/bin/env node

import {GetBuiltOptionsType} from "@opentr/cuttlecat/dist/arguments.js";
import {main} from "./focusRepositoryExtract.js";
import {addArguments, getYargs} from "./focusRepositoryExtractArguments.js";

(async () => {
    const y = addArguments(getYargs());

    const argv:GetBuiltOptionsType<typeof addArguments> = y.parseSync();

    await main({
        focusProjectCandidateSearchDataDirectory: argv.focusProjectCandidateSearchDataDirectory,
        excludeListFile: argv.excludeListFile,
        outputDirectory: argv.outputDirectory,
        minStars: argv.minStars,
        minForks: argv.minForks,
        minMentionableUsers: argv.minMentionableUsers,
        minPullRequests: argv.minPullRequests,
    });
})();
