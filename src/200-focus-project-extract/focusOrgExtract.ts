import * as fs from "fs";
import {mkdirSync, writeFileSync} from "fs";
import {join} from "path";
import {TaskRunOutputItem} from "@opentr/cuttlecat/dist/graphql/taskRunOutputItem.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {ProcessFileHelper} from "@opentr/cuttlecat/dist/processFileHelper.js";
import {readSlurpJsonFile} from "@opentr/cuttlecat/dist/utils.js";
import {readExcludeList} from "./focusRepositoryExtract.js";


const logger = log.createLogger("focusRepositoryExtract/command");

// Extract GitHub orgs from the focus project candidate search results for the repositories that belong to an org.

export interface Config {
    focusProjectCandidateSearchDataDirectory:string;
    organizationExcludeListFile:string;
    outputDirectory:string;
}

export async function main(config:Config) {
    // - list the focus project candidate search directories
    // - get the output files
    // - extract the orgs from repositories
    // - write the org names in a file

    logger.info(`Starting focus org extraction. Reading from ${config.focusProjectCandidateSearchDataDirectory}.`);
    const searchProcessFileHelper = new ProcessFileHelper(config.focusProjectCandidateSearchDataDirectory);

    const processStateDirectories = searchProcessFileHelper.getProcessStateDirectories();
    logger.info(`Found ${processStateDirectories.length} search output directories.`);

    if (processStateDirectories.length === 0) {
        logger.info(`No search output directories found, exiting.`);
        return;
    }

    // read organization exclude list
    logger.debug(`Reading organization exclude list from ${config.organizationExcludeListFile}.`);
    const organizationExcludeList = readExcludeList(config.organizationExcludeListFile);
    logger.debug(`Read ${organizationExcludeList.size} entries from organization exclude list.`);

    for (const processStateDirectory of processStateDirectories) {
        logger.info(`Processing search output directory ${processStateDirectory}.`);

        const searchOutputFiles:string[] = searchProcessFileHelper.getProcessOutputFiles(processStateDirectory);

        const repositories:Set<string> = new Set();

        for (const searchOutputFile of searchOutputFiles) {
            const searchOutputFilePath = join(config.focusProjectCandidateSearchDataDirectory, processStateDirectory, searchOutputFile);

            logger.info(`Processing search output file ${searchOutputFilePath}.`);

            await readSlurpJsonFile<TaskRunOutputItem>(searchOutputFilePath, (lineObject) => {
                const repository = lineObject.result;
                if (!repository.isInOrganization) {
                    return;
                }
                if (organizationExcludeList.has(repository.owner.login)) {
                    return;
                }

                repositories.add(repository.owner.login);
            });
        }

        logger.info(`Found ${repositories.size} organizations.`);

        const outputDir = join(config.outputDirectory, processStateDirectory);
        const outputFile = join(outputDir, "focus-organizations.json");

        logger.debug(`Going to write orgs to ${outputFile}.`);

        if (!fs.existsSync(outputDir)) {
            logger.debug(`Creating output directory ${outputDir}.`);
            mkdirSync(outputDir, {recursive: true});
        }

        const orgs = Array.from(repositories).sort(Intl.Collator().compare);
        writeFileSync(outputFile, JSON.stringify(orgs, null, 2));
    }
}
