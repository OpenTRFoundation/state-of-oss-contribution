import * as fs from "fs";
import {join} from "path";
import {TaskRunOutputItem} from "@opentr/cuttlecat/dist/graphql/taskRunOutputItem.js";

import {ProcessFileHelper} from "@opentr/cuttlecat/dist/processFileHelper.js";

import {readSlurpJsonFileSync} from "@opentr/cuttlecat/dist/utils.js";
import {RepositorySummaryFragment} from "../100-focus-project-candidate-search/focusProjectCandidateSearch.js";
import {LocationsOutput} from "../250-location-generation/locationGeneration.js";

export type FocusOrganization = {
    name:string;
    matchingRepositories:RepositorySummaryFragment[];
}

export type LocationResolutionRule = {
    mustNotBeInUserLocation:string[],
    parentMustBeInUserLocation:boolean,
};

export type LocationTruth = {
    mainEntry:string,
    parentMainEntry:string | null,
    resolutionRule:LocationResolutionRule | null,
    alternatives:string[],
};

export type LocationTruthMap = { [key:string]:LocationTruth }

export interface Config {
    focusProjectCandidateSearchDataDirectory:string;
    focusProjectExtractDataDirectory:string;
    locationsFilePath:string;
    locationResolutionRulesFilePath:string;
    outputDirectory:string;
}

export async function main(config:Config) {
    const repositoryTruthMap = buildFocusRepositoryTruthMap(config);
    const orgTruthMap = buildFocusOrgTruthMap(config);
    const locationTruthMap = buildLocationTruthMap(config);

    // write the truth maps to files
    const repositoryTruthMapFile = join(config.outputDirectory, "truth-map-focus-repositories.json");
    const orgTruthMapFile = join(config.outputDirectory, "truth-map-focus-organizations.json");
    const locationTruthMapFile = join(config.outputDirectory, "truth-map-locations.json");

    fs.writeFileSync(repositoryTruthMapFile, JSON.stringify(repositoryTruthMap, null, 2));
    fs.writeFileSync(orgTruthMapFile, JSON.stringify(orgTruthMap, null, 2));
    fs.writeFileSync(locationTruthMapFile, JSON.stringify(locationTruthMap, null, 2));
}

/**
 * Build a truth map of repositories that are marked as "focus projects" in the focus project extract data.
 * These are the repositories that are not in an organization and have a high number of stars, forks, pull requests, and mentionable users.
 * @param config
 */
export function buildFocusRepositoryTruthMap(config:Config) {
    // 1. Read the candidate search output files. These have all the repositories that were found in the candidate search.
    // 2. Read the extract output file for focus repositories. These have the repositories that were marked as "focus projects" in the extract process.
    // 3. Build a map of repositories that are marked as "focus projects" in the extract process.

    const {latestProjectCandidateSearchProcessStateDirectory, theMap} = readAllCandidateRepositories(config);

    // use the same timestamp for the extract process state directory
    const focusRepositoriesListFile = join(config.focusProjectExtractDataDirectory, latestProjectCandidateSearchProcessStateDirectory, "focus-repositories.json");
    const focusRepositoryNames = JSON.parse(fs.readFileSync(focusRepositoriesListFile, "utf8")) as string[];

    // now, filter the map to only include repositories that were marked as "focus projects" in the extract process.
    const filteredMap:{ [nameWithOwner:string]:RepositorySummaryFragment } = {};
    for (const nameWithOwner of focusRepositoryNames) {
        filteredMap[nameWithOwner] = theMap[nameWithOwner];
    }

    return filteredMap;
}

/**
 * Build a truth map of organizations and their repositories that we found. Only for the organizations and not for the individual users.
 * @param config
 */
function buildFocusOrgTruthMap(config:Config) {
    // 1. Read the candidate search output files. These have all the repositories that were found in the candidate search.
    // 2. Read the extract output file for organizations.
    // 3. Build a map of organizations with their matching repositories.

    const {latestProjectCandidateSearchProcessStateDirectory, theMap} = readAllCandidateRepositories(config);

    // use the same timestamp for the extract process state directory
    const focusOrganizationsListFile = join(config.focusProjectExtractDataDirectory, latestProjectCandidateSearchProcessStateDirectory, "focus-organizations.json");
    const focusOrganizationNames = JSON.parse(fs.readFileSync(focusOrganizationsListFile, "utf8")) as string[];

    // initialize the map with the organization names
    const focusOrgMap:{ [name:string]:FocusOrganization } = {};
    for (const name of focusOrganizationNames) {
        focusOrgMap[name] = {
            name,
            matchingRepositories: [],
        };
    }

    // now go over the repositories and add them to the matching organization, if they are in one.
    for (const repository of Object.values(theMap)) {
        if (!repository.isInOrganization) {
            continue;
        }
        const orgName = repository.owner.login;
        if (!focusOrgMap[orgName]) {
            continue;
        }
        focusOrgMap[orgName].matchingRepositories.push(repository);
        focusOrgMap[orgName].matchingRepositories.sort();
    }

    return focusOrgMap;
}

export function buildLocationTruthMap(config:Config):LocationTruthMap {
    const locationsMap:LocationsOutput = JSON.parse(fs.readFileSync(config.locationsFilePath, "utf8"));
    const locationResolutionRuleList:{ [locationAlternative:string]:LocationResolutionRule } = JSON.parse(fs.readFileSync(config.locationResolutionRulesFilePath, "utf8"));

    // map of <alternative, mainEntry> (e.g. <Cigli, Çiğli>)
    const locationTruthMap:LocationTruthMap = {};
    for (const locationName in locationsMap) {
        const mainEntry = locationsMap[locationName];
        mainEntry.alternatives.forEach((alternative) => {
            // locationTruthMap[alternative] = mainEntry.text;
            locationTruthMap[alternative] = {
                mainEntry: mainEntry.text,
                parentMainEntry: mainEntry.parent,
                resolutionRule: locationResolutionRuleList[alternative] ?? null,
                alternatives: mainEntry.alternatives
            };
        });
    }
    return locationTruthMap;
}

function readAllCandidateRepositories(config:Config) {
    const focusProjectCandidateSearchFileHelper = new ProcessFileHelper(config.focusProjectCandidateSearchDataDirectory);
    const latestProjectCandidateSearchProcessStateDirectory = focusProjectCandidateSearchFileHelper.getLatestProcessStateDirectory();
    if (!latestProjectCandidateSearchProcessStateDirectory) {
        throw new Error("No latest process state directory found");
    }

    let projectCandidateSearchProcessOutputFiles = focusProjectCandidateSearchFileHelper.getProcessOutputFiles(latestProjectCandidateSearchProcessStateDirectory);
    // add directory path to file names
    projectCandidateSearchProcessOutputFiles = projectCandidateSearchProcessOutputFiles.map((processOutputFile) => join(config.focusProjectCandidateSearchDataDirectory, latestProjectCandidateSearchProcessStateDirectory, processOutputFile));

    // build a map of all repositories that were found in the candidate search. we will filter this map later.
    const theMap:{ [nameWithOwner:string]:RepositorySummaryFragment } = {};
    for (const processOutputFile of projectCandidateSearchProcessOutputFiles) {
        const processOutput:TaskRunOutputItem[] = readSlurpJsonFileSync(processOutputFile);
        for (const fileOutput of processOutput) {
            const repositoryFragment = fileOutput.result as RepositorySummaryFragment;
            theMap[repositoryFragment.nameWithOwner] = repositoryFragment;
        }
    }
    return {latestProjectCandidateSearchProcessStateDirectory, theMap};
}
