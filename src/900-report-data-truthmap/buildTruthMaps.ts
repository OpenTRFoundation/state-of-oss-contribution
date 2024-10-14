import * as fs from "fs";
import {join} from "path";
import {TaskRunOutputItem} from "@opentr/cuttlecat/dist/graphql/taskRunOutputItem.js";

import {ProcessFileHelper} from "@opentr/cuttlecat/dist/processFileHelper.js";
import {ProcessState} from "@opentr/cuttlecat/dist/subcommand/execute.js";

import {readSlurpJsonFileSync} from "@opentr/cuttlecat/dist/utils.js";
import {RepositorySummaryFragment} from "../100-focus-project-candidate-search/focusProjectCandidateSearch.js";
import {LocationsOutput} from "../250-location-generation/locationGeneration.js";
import {UserAndContribSearchTaskSpec} from "../400-user-and-contrib-search/userAndContribSearch.js";
import {header, log} from "../util/log.js";
import {writePartitioned} from "../util/partition.js";

export type FocusOrganization = {
    name:string;
    numberOfMatchingRepositories:number;
    repositories:{[nameWithOwner:string]:RepositorySummaryFragment};
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

export type LocationTruthMap = { [location:string]:LocationTruth }

const RootLocation = "Turkey";

export interface UserLocation {
    // which province is the user in? In case there's no province information, this will be null.
    // this still means that the user is matched to Turkey though!
    province:string;
    // which location search query matched the user?
    locationSearchBucket:string;
    // what did the user enter as their location?
    enteredLocation:string;
    // all location seearch queries that matched the user
    allLocationSearchBuckets:string[];
}

export type UserLocationTruthMap = {
    [username:string]:UserLocation;
};

export interface Config {
    focusProjectCandidateSearchDataDirectory:string;
    focusProjectExtractDataDirectory:string;
    focusOrganizationDetailsDataDirectory:string;
    locationsFilePath:string;
    locationResolutionRulesFilePath:string;
    userAndContribSearchDataDirectory:string;
    outputDirectory:string;
}

export async function main(config:Config) {
    header(`Building truth maps...`);
    log(`Config: ${JSON.stringify(config, null, 2)}`);

    header(`Going to clean up the output directory`);
    cleanUpOutputDirectory(config);

    header(`Going to build the focus repository truth map`);
    // build the repository truth map, which contains all the repositories that were marked as "focus projects" in the extract process.
    const repositoryTruthMap = buildFocusRepositoryTruthMap(config);

    header(`Going to build the focus organization matching repositories truth map`);
    // build the organization matching repositories truth map, which contains all the organizations and number of their repositories that were matched in the focus candidate project search.
    const focusOrgMatchingRepositoriesCountTruthMap = buildFocusOrgMatchingRepositoriesCountTruthMap(config);

    header(`Going to build the focus organization truth map`);
    // build the org truth map, which contains all the organizations.
    const orgTruthMap = buildFocusOrgTruthMap(config, focusOrgMatchingRepositoriesCountTruthMap);

    header(`Going to build the location truth map`);
    // build the location truth map, which contains all the locations, their alternatives, and the resolution rules.
    const locationTruthMap = buildLocationTruthMap(config);

    header(`Going to read the user and contrib search output items`);
    // build a map of users and the task outputs for them (the task outputs are the users that were found in the user and contrib search).
    // discard the fetched data from archived tasks.
    const userAndContribSearchOutputItems = readAllUserAndContribSearchOutputItems(config);

    header(`Going to read the user and contrib search process state`);
    // read the process state for the user and contrib search, which will be used to filter out the outputs from the tasks
    // that were ran for an alternative location for the same user. We only want to keep the outputs from the tasks that were
    // ran for the resolved location for the user.
    const userAndContribSearchProcessState:ProcessState = readUserAndContribSearchProcessState(config);

    header(`Going to build the user location truth map`);
    // build the user location truth map, which contains all the users, their locations, and how they were matched with the locations.
    // this information is used to filter out the user and contrib search outputs for the users that were matched with multiple locations.
    const userLocationTruthMap = buildUserLocationTruthMap(locationTruthMap, userAndContribSearchOutputItems, userAndContribSearchProcessState);

    header(`Going to build the user and contrib truth map`);
    // build a map of users and their contributions.
    // filter out the task outputs for the tasks that were ran for an alternative location for the same user.
    const userAndContribTruthMap = buildUserAndContribTruthMap(userAndContribSearchOutputItems, userLocationTruthMap, userAndContribSearchProcessState);

    header(`Going to write the truth maps to files`);
    // write the truth maps to files
    writePartitioned(config.outputDirectory, "truth-map-focus-repositories", 50000, repositoryTruthMap);
    writePartitioned(config.outputDirectory, "truth-map-focus-organizations", 400, orgTruthMap);
    writePartitioned(config.outputDirectory, "truth-map-locations", 50000, locationTruthMap);
    writePartitioned(config.outputDirectory, "truth-map-user-locations", 50000, userLocationTruthMap);
    writePartitioned(config.outputDirectory, "truth-map-user-and-contrib", 10000, userAndContribTruthMap);

    // for debugging
    // fs.writeFileSync(join(config.outputDirectory, "debug-user-and-contrib-search-output-items.json"), JSON.stringify(userAndContribSearchOutputItems, null, 2));
    // fs.writeFileSync(join(config.outputDirectory, "debug-focus-org-matching-repositories-count-truth-map.json"), JSON.stringify(focusOrgMatchingRepositoriesCountTruthMap, null, 2));
}

function cleanUpOutputDirectory(config:Config) {
    log(`Cleaning up output directory ${config.outputDirectory}`);

    if (!fs.existsSync(config.outputDirectory)) {
        log(`Creating output directory ${config.outputDirectory}`);
        fs.mkdirSync(config.outputDirectory);
    }
    for (const file of fs.readdirSync(config.outputDirectory)) {
        if(file.startsWith("truth-map-") && file.endsWith(".json")){
            log(`Deleting ${file}`);
            fs.rmSync(join(config.outputDirectory, file));
        }
    }
}

/**
 * Build a truth map of repositories that are marked as "focus projects" in the focus project extract data.
 * These are the repositories that are not in an organization and have a high number of stars, forks, pull requests, and mentionable users.
 * @param config
 */
export function buildFocusRepositoryTruthMap(config:Config) {
    log(`Building focus repository truth map...`);

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

    log(`Found ${Object.keys(filteredMap).length} focus repositories`);

    return filteredMap;
}

/**
 * Build a truth map of organizations and number of their repositories that were matched in the focus candidate project search.
 * Only for the organizations and not for the individual users.
 *
 * @param config
 */
function buildFocusOrgMatchingRepositoriesCountTruthMap(config:Config) {
    log(`Building focus organization matching repositories truth map...`);

    // 1. Read the candidate search output files. These have all the repositories that were found in the candidate search.
    // 2. Read the extract output file for organizations.
    // 3. Build a map of organizations with their matching repositories.

    const {theMap} = readAllCandidateRepositories(config);

    const orgMatchingRepoMap:{[name:string]:{[repoName:string]:boolean}} = {};

    // now go over the repositories and add them to the matching organization, if they are in one.
    for (const repository of Object.values(theMap)) {
        if (!repository.isInOrganization) {
            continue;
        }

        const orgName = repository.owner.login;
        const repoNameWithOwner = repository.nameWithOwner;

        if(!orgMatchingRepoMap[orgName]){
            orgMatchingRepoMap[orgName] = {};
        }
        orgMatchingRepoMap[orgName][repoNameWithOwner] = true;
    }

    const output:{ [name:string]:number } = {};
    for(const orgName in orgMatchingRepoMap){
        output[orgName] = Object.keys(orgMatchingRepoMap[orgName]).length;
    }

    // sort the output by the number of matching repositories
    const sortedOutput:{ [name:string]:number } = {};
    Object.keys(output).sort((a, b) => output[b] - output[a]).forEach((key) => {
        sortedOutput[key] = output[key];
    });

    log(`Found ${Object.keys(sortedOutput).length} focus organizations`);

    return sortedOutput;
}

/**
 * Build a truth map of organizations and their repositories that we found. Only for the organizations and not for the individual users.
 * @param config
 * @param focusOrgMatchingRepositoriesCountTruthMap
 */
function buildFocusOrgTruthMap(config:Config, focusOrgMatchingRepositoriesCountTruthMap:{ [orgName:string]:number }) {
    log(`Building focus organization truth map...`);

    // 1. Read the focus organization details output files. These have all the orgs that were found in the candidate search.
    // 2. Read the extract output file for organizations.
    // 3. Build a map of organizations with their repositories.

    const focusOrganizationDetailsFileHelper = new ProcessFileHelper(config.focusOrganizationDetailsDataDirectory);
    const latestProcessStateDirectory = focusOrganizationDetailsFileHelper.getLatestProcessStateDirectory();
    if (!latestProcessStateDirectory) {
        throw new Error("No latest process state directory found");
    }

    const processStateFilePath = focusOrganizationDetailsFileHelper.getProcessStateFilePath(latestProcessStateDirectory);
    const processState:ProcessState = JSON.parse(fs.readFileSync(processStateFilePath, "utf8"));
    // as the branch of this code will only contain the completed tasks, we don't need to check if the process is complete.
    // if (processState.completionDate == null) {
    //     throw new Error("Latest process is not complete");
    // }

    let processOutputFiles = focusOrganizationDetailsFileHelper.getProcessOutputFiles(latestProcessStateDirectory);
    // add directory path to file names
    processOutputFiles = processOutputFiles.map((processOutputFile) => join(config.focusOrganizationDetailsDataDirectory, latestProcessStateDirectory, processOutputFile));

    const focusOrgMap:{ [name:string]:FocusOrganization } = {};

    // collect all data from all process output files, per org
    for (const processOutputFile of processOutputFiles) {
        log(`Reading ${processOutputFile}`);
        const processOutput:TaskRunOutputItem[] = readSlurpJsonFileSync(processOutputFile);
        for (const fileOutput of processOutput) {
            if (processState.archived[fileOutput.taskId]) {
                // the output was found in an archived task, let's discard the output.
                continue;
            }

            if(!fileOutput.result){
                // ignore these results.
                // happens when the org is not found.
                continue;
            }

            const orgName = fileOutput.result.login;

            if (!orgName) {
                // ignore these results.
                // should never happen actually!
                continue;
            }

            if(!focusOrgMap[orgName]){
                focusOrgMap[orgName] = {
                    name: orgName,
                    numberOfMatchingRepositories: focusOrgMatchingRepositoriesCountTruthMap[orgName] ?? 0,
                    repositories: {},
                };
            }

            for(const repository of fileOutput.result.repositories.nodes) {
                // in case of duplicates, we will overwrite the previous entry.
                focusOrgMap[orgName].repositories[repository.nameWithOwner] = repository;
            }
        }
    }

    log(`Found ${Object.keys(focusOrgMap).length} organizations`);

    return focusOrgMap;
}

/**
 * Build a truth map of locations and their alternatives.
 * @param config
 */
export function buildLocationTruthMap(config:Config):LocationTruthMap {
    log(`Building location truth map...`);

    // 1. Read the locations file.
    // 2. Read the location resolution rules file.
    // 3. Build a map of locations with their alternatives. Each alternative has a reference to the main entry and the resolution rule.

    const locationsMap:LocationsOutput = JSON.parse(fs.readFileSync(config.locationsFilePath, "utf8"));
    const locationResolutionRuleList:{
        [locationAlternative:string]:LocationResolutionRule
    } = JSON.parse(fs.readFileSync(config.locationResolutionRulesFilePath, "utf8"));

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

    log(`Found ${Object.keys(locationTruthMap).length} locations`);

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
        log(`Reading ${processOutputFile}`);
        const processOutput:TaskRunOutputItem[] = readSlurpJsonFileSync(processOutputFile);
        for (const fileOutput of processOutput) {
            const repositoryFragment = fileOutput.result as RepositorySummaryFragment;
            theMap[repositoryFragment.nameWithOwner] = repositoryFragment;
        }
    }
    return {latestProjectCandidateSearchProcessStateDirectory, theMap};
}

/**
 * Read the user and contrib search output and build a map.
 * The key is the username and the value is the list of output items.
 * Outputs from the archived tasks are discarded, as they are already re-fetched in a narrowed down task.
 * @param config
 */
export function readAllUserAndContribSearchOutputItems(config:Config):{ [username:string]:TaskRunOutputItem[] } {
    log(`Building user and contrib search output map...`);

    const userAndContribFileHelper = new ProcessFileHelper(config.userAndContribSearchDataDirectory);
    const latestProcessStateDirectory = userAndContribFileHelper.getLatestProcessStateDirectory();
    if (!latestProcessStateDirectory) {
        throw new Error("No latest process state directory found");
    }

    const processStateFilePath = userAndContribFileHelper.getProcessStateFilePath(latestProcessStateDirectory);

    const processState:ProcessState = JSON.parse(fs.readFileSync(processStateFilePath, "utf8"));
    // as the branch of this code will only contain the completed tasks, we don't need to check if the process is complete.
    // if (processState.completionDate == null) {
    //     throw new Error("Latest process is not complete");
    // }

    let processOutputFiles = userAndContribFileHelper.getProcessOutputFiles(latestProcessStateDirectory);
    // add directory path to file names
    processOutputFiles = processOutputFiles.map((processOutputFile) => join(config.userAndContribSearchDataDirectory, latestProcessStateDirectory, processOutputFile));

    // collect all data from all process output files, per user
    const output:{ [username:string]:TaskRunOutputItem[] } = {};
    for (const processOutputFile of processOutputFiles) {
        log(`Reading ${processOutputFile}`);
        const processOutput:TaskRunOutputItem[] = readSlurpJsonFileSync(processOutputFile);
        for (const fileOutput of processOutput) {
            if (processState.archived[fileOutput.taskId]) {
                // the output was found in an archived task, let's discard the output.
                continue;
            }
            const username = fileOutput.result.login;

            if (!username) {
                // this is not an error, as we might have some results that are not users.
                // I think, this is the case for orgs that were previously users.
                // ignore these results.
                continue;
            }

            if (output[username] == null) {
                output[username] = [];
            }
            output[username].push(fileOutput);
        }
    }

    log(`Found ${Object.keys(output).length} users`);

    return output;
}

function readUserAndContribSearchProcessState(config:Config) {
    log(`Reading user and contrib search process state...`);

    const userAndContribFileHelper = new ProcessFileHelper(config.userAndContribSearchDataDirectory);
    const latestProcessStateDirectory = userAndContribFileHelper.getLatestProcessStateDirectory();
    if (!latestProcessStateDirectory) {
        throw new Error("No latest process state directory found");
    }

    const processStateFilePath = userAndContribFileHelper.getProcessStateFilePath(latestProcessStateDirectory);

    log(`Reading ${processStateFilePath}`);
    const processState:ProcessState = JSON.parse(fs.readFileSync(processStateFilePath, "utf8"));
    return processState;
}

/**
 * Build a truth map of users and their locations.
 *
 * The user might be matched with multiple locations. For example, for a user that entered "Istanbul, Turkey" as their location,
 * we will have entries for them in searches for Istanbul and Turkey. Thus, we need to collect all, then decide on which one is better.
 * This is done in this function.
 *
 * The key is the username and the value is an object that has some information about the user's resolved province, how the
 * user was matched with the province, and what the user entered as their location.
 *
 * @param locationTruthMap
 * @param userAndContribSearchOutputItems
 * @param userAndContribSearchProcessState
 */
export function buildUserLocationTruthMap(locationTruthMap:LocationTruthMap, userAndContribSearchOutputItems:{[username:string]:TaskRunOutputItem[]}, userAndContribSearchProcessState:ProcessState):UserLocationTruthMap {
    log(`Building user location truth map...`);

    type IntermediateUserLocationEntries = {
        enteredLocation:string;
        locationBuckets:Set<string>;
    }

    log(`Building intermediate user location entries map...`);
    // collect all location buckets for each user
    // for example, for a user that entered "Istanbul, Turkey" as their location,
    // we will have entries for them in searches for Istanbul and Turkey.
    // thus, this map will have 2 entries for this user.
    const intermediateUserLocationEntriesMap:{ [key:string]:IntermediateUserLocationEntries } = {};

    for (const user in userAndContribSearchOutputItems) {
        const outputsForUser = userAndContribSearchOutputItems[user];

        for (const output of outputsForUser) {
            // Debugging manually
            // if(username !== "user1") {
            //     return;
            // }

            // this is how we got this user entry
            // the user might be matched with other locations too!
            // so, we need to store this information.
            const taskSpec = userAndContribSearchProcessState.resolved[output.taskId].task as UserAndContribSearchTaskSpec;
            const locationBucket = taskSpec.location;

            let element = intermediateUserLocationEntriesMap[user];
            if (!element) {
                element = intermediateUserLocationEntriesMap[user] = {
                    enteredLocation: output.result.location as string,
                    locationBuckets: new Set<string>(),
                };
            }

            element.locationBuckets.add(locationBucket);
        }
    }


    log(`Resolving user locations...`);
    // Let's identify user locations!
    //
    // Say user has this information in their profile:
    // "location":"Kurtkoy, Pendik, Istanbul, Turkey",
    // Instead of parsing this string and try to make sense of it, we're gonna use the location search queries that matched the user.
    // We already have the information of which location search queries matched the user in the state file. To do that
    // read the specs of the tasks that matched the user.
    //
    // For the user above, we will have entries for them in searches for Pendik, Istanbul and Turkey.
    // So, we need to collect all, then decide on which one is better.
    //
    // We need to make a decision which bucket is better for our representation.
    // We prefer storing the province information, as the district is too specific (not many people enter it).
    // Similarly, we prefer province over country, as country is too generic.
    //
    //
    // The other case is that there are ambiguous locations.
    // For users who are matched with "Sinop" location search query, we need to check if they are from Sinop in Turkey or Sinop in Brazil.
    // There's no easy way of doing it. We just need to traverse the location hierarchy and check if one of the parents (or their alternatives)
    // exist in the user location.
    // - Case 1: Sinop
    //   - So, if location is just "Sinop", then ignore the user
    //   - If location is "Sinop Turkey", "Sinop TR", "Türkiye, Sinop" etc. then it's fine
    // - Case 2: Can
    //   - There's a Çan district of Çanakkale in Turkey and Can in another country
    //   - Similar to case#1 above, but go 2 levels up in the hierarchy: First to Çanakkale and then to Turkey
    const userLocationMap:{ [key:string]:UserLocation } = {};
    for (const user of Object.keys(intermediateUserLocationEntriesMap)) {
        if (intermediateUserLocationEntriesMap[user].locationBuckets.size === 0) {
            // implementation error!
            throw new Error(`User ${user} has no location buckets`);
        }

        // first, resolve any ambiguous locations
        let resolvedLocationBuckets:string[];
        try {
            resolvedLocationBuckets = resolveLocationBuckets(locationTruthMap, intermediateUserLocationEntriesMap[user].locationBuckets, intermediateUserLocationEntriesMap[user].enteredLocation);
        } catch (e) {
            const message = `Error while resolving location buckets for user ${user}: ${e}`;
            console.error(message);
            console.error(e);
            throw new Error(message);
        }

        // no resolved location, ignore this user
        if (resolvedLocationBuckets.length === 0) {
            // logger.debug(`User ${user} has no resolved location buckets`);
            continue;
        }

        // then iterate over the resolved locations and find the deepest location
        let deepestLocationDepth = -1;
        let deepestLocation = null;
        for (const resolvedLocationBucket of resolvedLocationBuckets) {
            const depth = getLocationDepth(locationTruthMap, resolvedLocationBucket);
            if (depth > deepestLocationDepth) {
                deepestLocationDepth = depth;
                deepestLocation = resolvedLocationBucket;
            }
        }

        if (!deepestLocation) {
            // implementation error!
            throw new Error(`User ${user} has no deepest location`);
        }

        userLocationMap[user] = {
            province: getProvince(locationTruthMap, deepestLocation) as string,
            locationSearchBucket: deepestLocation,
            enteredLocation: intermediateUserLocationEntriesMap[user].enteredLocation,
            allLocationSearchBuckets: Array.from(intermediateUserLocationEntriesMap[user].locationBuckets),
        };
    }

    return userLocationMap;
}

/**
 * Build a truth map of users and their contributions.
 * Filter out the task outputs for the tasks that were ran for an alternative location for the same user.
 *
 * @param userAndContribSearchOutputItems
 * @param userLocationTruthMap
 * @param userAndContribSearchProcessState
 */
function buildUserAndContribTruthMap(userAndContribSearchOutputItems:{[username:string]:TaskRunOutputItem[]}, userLocationTruthMap:UserLocationTruthMap, userAndContribSearchProcessState:ProcessState) {
    log(`Building user and contrib truth map...`);
    const newMap:{[username:string]:TaskRunOutputItem[]} = {};
    // iterate over users and contributions. discard the outputs that are found when the location is not the one that the user is matched with.
    // remember, there might be same results for the same user, but with different locations.
    for (const username in userAndContribSearchOutputItems) {
        if (!userLocationTruthMap[username]) {
            // if there's no location information for the user, discard the user.
            continue;
        }

        for (const output of userAndContribSearchOutputItems[username]) {
            if (!newMap[username]) {
                newMap[username] = [];
            }
            const taskSpec:UserAndContribSearchTaskSpec = userAndContribSearchProcessState.resolved[output.taskId].task as UserAndContribSearchTaskSpec;
            if (userLocationTruthMap[username].locationSearchBucket === taskSpec.location) {
                newMap[username].push(output);
            }
        }
    }
    log(`Found ${Object.keys(newMap).length} users`);
    return newMap;
}

function resolveLocationBuckets(locationTruthMap:LocationTruthMap, locationBucketNames:Set<string>, enteredLocation:string) {
    // user entered location should be non-empty. otherwise, GitHub would not match them with this location.
    if (!enteredLocation) {
        // there can be a case where the user cleared their location after we created the initial search tasks.
        // but, we're not gonna handle that case and fail.
        throw new Error(`No entered location provided!`);
    }

    const resolvedLocationBuckets:string[] = []
    // resolve ambiguous locations
    for (const locationBucketName of locationBucketNames) {
        const resolves = resolveBucket(locationTruthMap, locationBucketName, enteredLocation);
        if (resolves) {
            resolvedLocationBuckets.push(locationBucketName)
        }
    }

    return resolvedLocationBuckets;
}

function resolveBucket(locationTruthMap:LocationTruthMap, locationBucketName:string, enteredLocation:string) {
    const truthForBucket = locationTruthMap[locationBucketName];
    if (!truthForBucket) {
        log(`Location ${locationBucketName} is not in the locations list`);
        return false;
    }
    const locationResolutionRule = truthForBucket.resolutionRule;

    if (!locationResolutionRule) {
        return true;
    }

    if (locationResolutionRule.mustNotBeInUserLocation) {
        for (const str of locationResolutionRule.mustNotBeInUserLocation) {
            if (includes(enteredLocation, str)) {
                return false;
            }
        }
    }

    if (!locationResolutionRule.parentMustBeInUserLocation) {
        return true;
    }

    if (locationResolutionRule.parentMustBeInUserLocation) {
        const bucketMainEntry = truthForBucket.mainEntry;

        // check if the location is in the list. it should be, otherwise, why did we search users for this location?
        if (!bucketMainEntry) {
            log(`Location ${locationBucketName} is not in the locations list`);
            return false;
        }

        const parentMainEntry = locationTruthMap[bucketMainEntry].parentMainEntry;

        if (!parentMainEntry) {
            // this is an implementation error, as all the items in the ambiguousLocations list should have a parent.
            // Turkey, TR, etc. root locations that cannot be in the ambiguousLocations list.
            throw new Error(`Location ${locationBucketName} has no parent`);
        }

        // if one of the parent alternatives is in the user entered location, this location is good!
        for (const parentAlternative of locationTruthMap[parentMainEntry].alternatives) {
            if (includes(enteredLocation, parentAlternative)) {
                return true;
            }
        }

        // otherwise, we need to check the root.
        const rootMainEntry = locationTruthMap[RootLocation].mainEntry;
        for (const rootAlternative of locationTruthMap[rootMainEntry].alternatives) {
            if (includes(enteredLocation, rootAlternative)) {
                return true;
            }
        }
    }

    return false;
}

function getLocationDepth(locationTruthMap:LocationTruthMap, location:string):number {
    if (!locationTruthMap[location]) {
        return 0;
    }
    const parent = locationTruthMap[location].parentMainEntry;
    if (!parent) {
        return 0;
    }
    return 1 + getLocationDepth(locationTruthMap, parent);
}

function getProvince(locationTruthMap:LocationTruthMap, location:string):string | null {
    const locationTruth = locationTruthMap[location];
    if (!locationTruth) {
        log(`Location ${location} is not in the locations list`);
        return null;
    }

    const mainEntry = locationTruth.mainEntry;
    if (!mainEntry) {
        log(`Location alternative ${location} is not in the locations list`);
        return null;
    }
    const parent = locationTruthMap[mainEntry].parentMainEntry;
    if (!parent) {
        return null;
    }
    if (!locationTruthMap[parent].parentMainEntry) {
        return mainEntry;
    }
    return getProvince(locationTruthMap, parent);
}

function includes(enteredLocation:string, str:string) {
    return enteredLocation.toLocaleLowerCase("en").includes(str.toLocaleLowerCase("en"))
        ||
        enteredLocation.toLocaleLowerCase("tr").includes(str.toLocaleLowerCase("tr"));
}
