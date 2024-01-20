import * as fs from "fs";
import {mkdirSync, writeFileSync} from "fs";
import {join} from "path";

import {TaskRunOutputItem} from "@opentr/cuttlecat/dist/graphql/taskRunOutputItem.js";

import * as log from "@opentr/cuttlecat/dist/log.js";
import {ProcessFileHelper} from "@opentr/cuttlecat/dist/processFileHelper.js";
import {readSlurpJsonFile} from "@opentr/cuttlecat/dist/utils.js";


const logger = log.createLogger("focusRepositoryExtract/command");

// Extract GitHub repositories from the focus project candidate search results, that do not belong to a GitHub organization.
// Criteria for such repositories are much stricter than for orgs.

export interface Config {
    focusProjectCandidateSearchDataDirectory:string;
    repositoryExcludeListFile:string;
    organizationExcludeListFile:string;
    outputDirectory:string;
    minStars:number;
    minForks:number;
    minMentionableUsers:number;
    minPullRequests:number;
}

export async function main(config:Config) {
    // - list the focus project candidate search directories
    // - get the output files
    // - extract the repositories that don't belong to any orgs
    // - if they match the criteria, write them in a file

    logger.info(`Starting focus repository extraction. Reading from ${config.focusProjectCandidateSearchDataDirectory}.`);
    const searchProcessFileHelper = new ProcessFileHelper(config.focusProjectCandidateSearchDataDirectory);

    const processStateDirectories = searchProcessFileHelper.getProcessStateDirectories();
    logger.info(`Found ${processStateDirectories.length} search output directories.`);

    if (processStateDirectories.length === 0) {
        logger.info(`No search output directories found, exiting.`);
        return;
    }

    // read repository exclude list
    logger.debug(`Reading repository exclude list from ${config.repositoryExcludeListFile}.`);
    const repositoryExcludeList = readExcludeList(config.repositoryExcludeListFile);
    logger.debug(`Read ${repositoryExcludeList.size} entries from repository exclude list.`);

    // read organization exclude list
    logger.debug(`Reading organization exclude list from ${config.organizationExcludeListFile}.`);
    const organizationExcludeList = readExcludeList(config.organizationExcludeListFile);
    logger.debug(`Read ${organizationExcludeList.size} entries from organization exclude list.`);

    for (const processStateDirectory of processStateDirectories) {
        logger.info(`Processing search output directory ${processStateDirectory}.`);

        const searchOutputFiles:string[] = searchProcessFileHelper.getProcessOutputFiles(processStateDirectory);
        logger.info(`Found ${searchOutputFiles.length} search output files.`);

        const matchedRepoSet = new Set<string>();

        for (const searchOutputFile of searchOutputFiles) {
            const searchOutputFilePath = join(config.focusProjectCandidateSearchDataDirectory, processStateDirectory, searchOutputFile);

            logger.info(`Processing search output file ${searchOutputFilePath}.`);

            await readSlurpJsonFile<TaskRunOutputItem>(searchOutputFilePath, (lineObject) => {
                const repository = lineObject.result;
                if (repository.isInOrganization) {
                    return;
                }

                const identifier = repository.nameWithOwner;

                if (repositoryExcludeList.has(identifier)) {
                    return;
                }

                const orgIdentifier = repository.owner.login;
                if (organizationExcludeList.has(orgIdentifier)) {
                    return;
                }

                const matchesCriteria =
                    repository.forkCount >= config.minForks &&
                    repository.stargazerCount >= config.minStars &&
                    repository.mentionableUsers.totalCount >= config.minMentionableUsers &&
                    repository.pullRequests.totalCount >= config.minPullRequests;

                if (matchesCriteria) {
                    matchedRepoSet.add(identifier);
                } else {
                    logger.debug(`Repository ${identifier} could be interesting, but does not match criteria.`);
                }
            });
        }

        logger.info(`Found ${matchedRepoSet.size} repositories that match criteria.`);

        const outputDir = join(config.outputDirectory, processStateDirectory);
        const outputFile = join(outputDir, "focus-repositories.json");

        logger.debug(`Going to write orgs to ${outputFile}.`);

        if (!fs.existsSync(outputDir)) {
            logger.debug(`Creating output directory ${outputDir}.`);
            mkdirSync(outputDir, {recursive: true});
        }

        const repositories = Array.from(matchedRepoSet).sort(Intl.Collator().compare);
        writeFileSync(outputFile, JSON.stringify(repositories, null, 2));
    }
}

export function readExcludeList(excludeListFile:string) {
    const excludeArray:string[] = JSON.parse(fs.readFileSync(excludeListFile, "utf8"));
    return new Set(excludeArray);
}
