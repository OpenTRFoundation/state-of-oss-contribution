import * as fs from "fs";
import {join} from "path";
import {TaskRunOutputItem} from "@opentr/cuttlecat/dist/graphql/taskRunOutputItem.js";
import {RepositorySummaryFragment} from "../100-focus-project-candidate-search/focusProjectCandidateSearch.js";
import {
    ContributionByRepositoryFragment,
    UserAndContribSearchResultFragment
} from "../400-user-and-contrib-search/userAndContribSearch.js";
import {FocusOrganization, UserLocation} from "../900-report-data-truthmap/buildTruthMaps.js";
import {readPartitioned} from "../util/partition.js";

export interface Config {
    reportDataTruthMapDirectory:string;
    outputDirectory:string;
}

const USER_SCORE_COEFFICIENTS = {
    PullRequest: 10,
    PullRequestReview: 5,
    Commit: 3,
    Issue: 1
};

const ACTIVE_USER_CRITERIA = {
    MinOwnedRepositories: 1,
    MinActivityScore: 1,
};

const OSS_CONTRIBUTOR_MIN_SCORE = 20;

const UNKNOWN_PROVINCE = "-Unknown-";

const LEADER_BOARD_SIZE = 100;

interface UserProfile {
    username: string;
    company:string | null;
    name:string | null;
    enteredLocation:string | null;
    signedUpAt:string;
    emailDomain:string | null;
    socialAccounts:string[];
    websiteUrl:string | null;
    // resolved province
    province:string | null;     // could be unknown
}

type UserStats = {
    followers:number;
    gists:number;
    issueComments:number;
    issues:number;
    pullRequests:number;
    repositories:number;
    repositoriesContributedTo:number;
    repositoryDiscussionComments:number;
    repositoryDiscussions:number;
    sponsorCount:number;
    sponsoringCount:number;
}

interface UserInformation {
    profile:UserProfile;
    score:number;
    stats:UserStats;
    contributionScoresPerRepository:{[repoNameWithOwner:string]:number};
}

interface CompanyInformation {
    name:string;
    numberOfUsers:number;
    sumOfScores:number;
    contributionScoresPerRepository:{[repoNameWithOwner:string]:number};
}

export async function main(config:Config) {
    const focusRepositories:{ [nameWithOwner:string]:RepositorySummaryFragment } = readPartitioned(config.reportDataTruthMapDirectory, "truth-map-focus-repositories.index.json");
    const focusOrganizations:{ [orgName:string]:FocusOrganization } = readPartitioned(config.reportDataTruthMapDirectory, "truth-map-focus-organizations.index.json");
    const userAndContribSearchTruthMap:{ [username:string]:TaskRunOutputItem[] } = readPartitioned(config.reportDataTruthMapDirectory, "truth-map-user-and-contrib.index.json");
    const userLocationsTruthMap:{ [username:string]:UserLocation } = readPartitioned(config.reportDataTruthMapDirectory, "truth-map-user-locations.index.json");

    const focusOrganizationScoreMap = buildFocusOrganizationScoreMap(focusOrganizations);
    const focusRepositoriesScoreMap = buildFocusRepositoryScoreMap(focusRepositories);

    // intermediate data
    const userInformationMap = buildUserInformationMap(userAndContribSearchTruthMap, userLocationsTruthMap);
    const activeUserInformationMap = buildActiveUserInformationMap(userInformationMap);
    const ossContributorInformationMap = buildOssContributorInformationMap(activeUserInformationMap, focusOrganizationScoreMap, focusRepositoriesScoreMap);

    const userProvinceCountsMap = buildUserProvinceCountsMap(userInformationMap);
    const activeUserProvinceCountsMap = buildUserProvinceCountsMap(activeUserInformationMap);
    const ossContributorProvinceCountsMap = buildUserProvinceCountsMap(ossContributorInformationMap);
    const userSignedUpAtMap = buildUserSignedUpAtMap(userInformationMap);

    const activeUserLeaderBoard = buildUserLeaderBoard(activeUserInformationMap);
    const ossContributorLeaderBoard = buildUserLeaderBoard(ossContributorInformationMap);
    const companyOssContributionInformationMap = buildCompanyInformationMap(ossContributorInformationMap);

    fs.writeFileSync(join(config.outputDirectory, "110-focus-organization-score-map.json"), JSON.stringify(focusOrganizationScoreMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "120-focus-repository-score-map.json"), JSON.stringify(focusRepositoriesScoreMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "210-user-province-counts-map.json"), JSON.stringify(userProvinceCountsMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "220-active-user-province-counts-map.json"), JSON.stringify(activeUserProvinceCountsMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "230-oss-contributor-province-counts-map.json"), JSON.stringify(ossContributorProvinceCountsMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "240-user-signed-up-at-map.json"), JSON.stringify(userSignedUpAtMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "310-active-user-leader-board.json"), JSON.stringify(activeUserLeaderBoard, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "320-oss-contributor-leader-board.json"), JSON.stringify(ossContributorLeaderBoard, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "330-company-oss-contribution-information-map.json"), JSON.stringify(companyOssContributionInformationMap, null, 2));

    // DEBUG
    // fs.writeFileSync(join(config.outputDirectory, "debug-user-information-map.json"), JSON.stringify(userInformationMap, null, 2));
    // fs.writeFileSync(join(config.outputDirectory, "debug-active-user-information-map.json"), JSON.stringify(activeUserInformationMap, null, 2));
    // fs.writeFileSync(join(config.outputDirectory, "debug-oss-contributor-information-map.json"), JSON.stringify(ossContributorInformationMap, null, 2));
    // fs.writeFileSync(join(config.outputDirectory, "debug-focus-repository-contribution-score-map.json"), JSON.stringify(focusRepositoryContributionScoreMap, null, 2));
    // fs.writeFileSync(join(config.outputDirectory, "debug-focus-organization-contribution-score-map.json"), JSON.stringify(focusOrganizationContributionScoreMap, null, 2));
}

/**
 * Builds a map of the focus organization name to the score of the organization.
 *
 * The score is calculated as the number of matched focus repository candidates in the organization.
 * As we don't have all the repositories in the organization, we can't calculate the score better than this right now.
 *
 * @param focusOrganizations
 */
function buildFocusOrganizationScoreMap(focusOrganizations:{ [orgName:string]:FocusOrganization }) {
    const scoreMap:{ [org:string]:number } = {};

    for (const focusOrg of Object.values(focusOrganizations)) {
        const orgName = focusOrg.name;
        scoreMap[orgName] = focusOrg.matchingRepositories.length;
    }

    // sort scoreMap by score
    // Javascript objects cannot be sorted for sure (we migth end up with numeric org names at the top), but it is ok.
    const scoreMapEntries = Object.entries(scoreMap);
    scoreMapEntries.sort((a, b) => b[1] - a[1]);
    const sortedScoreMap:{ [org:string]:number } = {};
    for (const scoreMapEntry of scoreMapEntries) {
        sortedScoreMap[scoreMapEntry[0]] = scoreMapEntry[1];
    }

    return sortedScoreMap;
}

/**
 * Builds a map of the focus repository names (with owner) to the score of the repository.
 *
 * The score is calculated as the number of stars of the repository.
 *
 * @param focusRepositories
 */
function buildFocusRepositoryScoreMap(focusRepositories:{ [nameWithOwner:string]:RepositorySummaryFragment }) {
    const scoreMap:{ [nameWithOwner:string]:number } = {};

    for (const focusRepo of Object.values(focusRepositories)) {
        const nameWithOwner = focusRepo.nameWithOwner;
        scoreMap[nameWithOwner] = focusRepo.stargazerCount;
    }

    // sort scoreMap by score
    // Javascript objects cannot be sorted for sure (we migth end up with numeric repository names at the top), but it is ok.
    const scoreMapEntries = Object.entries(scoreMap);
    scoreMapEntries.sort((a, b) => b[1] - a[1]);
    const sortedScoreMap:{ [nameWithOwner:string]:number } = {};
    for (const scoreMapEntry of scoreMapEntries) {
        sortedScoreMap[scoreMapEntry[0]] = scoreMapEntry[1];
    }
    return sortedScoreMap;
}

/**
 * Builds a map of the username to the user information.
 *
 * At this point, all contributions are included, not just contributions to the focus projects.
 *
 * The score is calculated as the sum of the contributions of the user.
 *
 * Each contribution type has a different coefficient, which is hardcoded in the USER_SCORE_COEFFICIENTS object.
 *
 * @param userAndContribSearchTruthMap
 * @param userLocationsTruthMap
 */
function buildUserInformationMap(userAndContribSearchTruthMap:{ [username:string]:TaskRunOutputItem[] }, userLocationsTruthMap:{ [username:string]:UserLocation }) {
    const userInformationMap:{ [username:string]:UserInformation } = {};

    function processContributions(contribScores:{[repoNameWithOwner:string]:number}, coefficient:number, contributions:ContributionByRepositoryFragment[]) {
        for(const contribution of contributions){
            const repoName = contribution.repository.nameWithOwner;
            contribScores[repoName] = (contribScores[repoName] ?? 0) + contribution.contributions.totalCount * coefficient;
        }
    }

    // iterate over users and their contributions
    for (const username in userAndContribSearchTruthMap) {
        let profile:UserProfile | null = null;
        let stats:UserStats | null = null;
        const contribScores:{[repoNameWithOwner:string]:number} = {};

        const outputsForUser = userAndContribSearchTruthMap[username];
        for (const output of outputsForUser) {
            const fragment = output.result as UserAndContribSearchResultFragment;

            const socialAccounts:string[] = [];
            for(const socialAccount of fragment.socialAccounts.edges){
                socialAccounts.push(socialAccount.node.url);
            }

            // use the latest entry to build the user profile!
            profile = {
                username: username,
                name: fragment.name,
                company: fragment.company,
                enteredLocation: fragment.location,
                signedUpAt: fragment.createdAt,
                emailDomain: fragment.email,
                socialAccounts: socialAccounts,
                websiteUrl: fragment.websiteUrl,
                province: userLocationsTruthMap[username].province
            };

            // use the latest entry to build the user stats! these are all-time stats anyway, not dependent on the
            // period of the search for the contributions.
            stats = {
                followers: fragment.followers.totalCount,
                gists: fragment.gists.totalCount,
                issueComments: fragment.issueComments.totalCount,
                issues: fragment.issues.totalCount,
                pullRequests: fragment.pullRequests.totalCount,
                repositories: fragment.repositories.totalCount,
                repositoriesContributedTo: fragment.repositoriesContributedTo.totalCount,
                repositoryDiscussionComments: fragment.repositoryDiscussionComments.totalCount,
                repositoryDiscussions: fragment.repositoryDiscussions.totalCount,
                sponsorCount: fragment.sponsors.totalCount,
                sponsoringCount: fragment.sponsoring.totalCount,
            };

            processContributions(contribScores, USER_SCORE_COEFFICIENTS.PullRequest, fragment.contributionsCollection.pullRequestContributionsByRepository);
            processContributions(contribScores, USER_SCORE_COEFFICIENTS.PullRequestReview, fragment.contributionsCollection.pullRequestReviewContributionsByRepository);
            processContributions(contribScores, USER_SCORE_COEFFICIENTS.Commit, fragment.contributionsCollection.commitContributionsByRepository);
            processContributions(contribScores, USER_SCORE_COEFFICIENTS.Issue, fragment.contributionsCollection.issueContributionsByRepository);
        }

        // sort the contribScores by score
        const contribScoresEntries = Object.entries(contribScores);
        contribScoresEntries.sort((a, b) => b[1] - a[1]);
        const sortedContribScores:{[repoNameWithOwner:string]:number} = {};
        for (const contribScoresEntry of contribScoresEntries) {
            sortedContribScores[contribScoresEntry[0]] = contribScoresEntry[1];
        }

        // add up the scores
        let score = 0;
        for(const repoNameWithOwner in contribScores){
            score += contribScores[repoNameWithOwner];
        }

        if(!profile || !stats){
            continue;
        }

        userInformationMap[username] = {
            profile: profile,
            score: score,
            stats: stats,
            contributionScoresPerRepository: sortedContribScores,
        };
    }

    return userInformationMap;
}

/**
 * Builds a map of the username to the user information for the active users.
 *
 * Filters the existing user information map by the active user criteria.
 *
 * @param userInformationMap
 */
function buildActiveUserInformationMap(userInformationMap:{ [username:string]:UserInformation }) {
    const activeUserInformationMap:{ [username:string]:UserInformation } = {};

    for(const username in userInformationMap){
        const userInformation = userInformationMap[username];
        if(userInformation.stats.repositories < ACTIVE_USER_CRITERIA.MinOwnedRepositories){
            continue;
        }

        if(userInformation.score < ACTIVE_USER_CRITERIA.MinActivityScore){
            continue;
        }
        activeUserInformationMap[username] = userInformation;
    }

    return activeUserInformationMap;
}

/**
 * Builds a map of the username to the user information for the users that contributed to the focus projects.
 *
 * Creates a new user information map, where the contributions are filtered to only include contributions to the focus projects.
 *
 * @param userInformationMap
 * @param focusOrganizationScoreMap
 * @param focusRepositoriesScoreMap
 */
function buildOssContributorInformationMap(userInformationMap:{ [username:string]:UserInformation }, focusOrganizationScoreMap:{ [orgName:string]:number }, focusRepositoriesScoreMap:{ [nameWithOwner:string]:number }) {
    const ossContributorInformationMap:{ [username:string]:UserInformation } = {};

    for(const username in userInformationMap) {
        const userInformation = userInformationMap[username];
        const ossContribScores:{[repoNameWithOwner:string]:number} = {};
        let ossContributionScore = 0;

        for(const repoNameWithOwner in userInformation.contributionScoresPerRepository){
            const orgName = repoNameWithOwner.split("/")[0];
            if(focusRepositoriesScoreMap[repoNameWithOwner] || focusOrganizationScoreMap[orgName]){
                ossContribScores[repoNameWithOwner] = userInformation.contributionScoresPerRepository[repoNameWithOwner];
                ossContributionScore += ossContribScores[repoNameWithOwner];
            }
        }

        if(ossContributionScore < OSS_CONTRIBUTOR_MIN_SCORE){
            continue;
        }

        ossContributorInformationMap[username] = {
            // same
            profile: userInformation.profile,
            stats: userInformation.stats,

            //different
            score: ossContributionScore,
            contributionScoresPerRepository: ossContribScores,
        };
    }

    return ossContributorInformationMap;
}

/**
 * Builds a map of provinces and the number of users in that province.
 *
 * @param userInformationMap
 */
function buildUserProvinceCountsMap(userInformationMap:{ [username:string]:UserInformation }) {
    const userProvinceCountsMap:{ [province:string]:number } = {};

    for(const username in userInformationMap){
        const userInformation = userInformationMap[username];
        const province = userInformation.profile.province ?? UNKNOWN_PROVINCE;
        userProvinceCountsMap[province] = (userProvinceCountsMap[province] ?? 0) + 1;
    }

    // sort the output by number of users
    const outputEntries = Object.entries(userProvinceCountsMap);
    outputEntries.sort((a, b) => b[1] - a[1]);
    const sortedOutput:{[province:string]:number} = {};
    for (const outputEntry of outputEntries) {
        sortedOutput[outputEntry[0]] = outputEntry[1];
    }

    return sortedOutput;
}

/**
 * Builds a map of the years and the number of users that signed up in that year.
 *
 * Example:
 * {
 *   "2008": 54,
 *   "2009": 211,
 *   "2010": 564,
 * }
 *
 * @param userInformationMap
 */
function buildUserSignedUpAtMap(userInformationMap:{ [username:string]:UserInformation }) {
    const signedUpAtMap:{[year:string]:number} = {};
    for(const username in userInformationMap){
        const userInformation = userInformationMap[username];
        const year = userInformation.profile.signedUpAt.substring(0, 4);
        signedUpAtMap[year] = (signedUpAtMap[year] ?? 0) + 1;
    }
    return signedUpAtMap;
}

/**
 * Builds a list of the top N active users based on their score for the given user information map.
 *
 * Example:
 * [
 *   {
 *     "profile": {
 *       "username": "john-doe",
 *       "name": "John Doe",
 *       ...
 *     },
 *     "score": 79536,
 *     "stats": {
 *       "followers": 81,
 *       "gists": 3,
 *       ...
 *     },
 *     "contributionScoresPerRepository": {
 *       "abc/def": 29202,
 *       ...
 *     }
 *   },
 *   ...
 * ]
 *
 * @param activeUserInformationMap
 */
function buildUserLeaderBoard(activeUserInformationMap:{ [username:string]:UserInformation }) {
    const list:UserInformation[] = [];

    // Javascript objects cannot be sorted.
    // So, we need to get the keys, sort them by user score, and then iterate over the keys.

    const usernames = Object.keys(activeUserInformationMap);
    usernames.sort((a, b) => activeUserInformationMap[b].score - activeUserInformationMap[a].score);

    // get the top N
    for(let i = 0; i < LEADER_BOARD_SIZE && i < usernames.length; i++){
        list.push(activeUserInformationMap[usernames[i]]);
    }

    return list;
}

/**
 * Builds a map of the company name to the company information.
 *
 * Example:
 * {
 *    "foo": {
 *     "name": "foo",
 *     "numberOfUsers": 3,
 *     "sumOfScores": 3147,
 *     "contributionScoresPerRepository": {
 *       "foo/bar": 2997,
 *       "foo/baz": 114,
 *     }
 *   },
 *   ...
 * }
 *
 * @param userMap
 */
function buildCompanyInformationMap(userMap:{ [username:string]:UserInformation }) {
    const companyMap:{[companyName:string]:CompanyInformation} = {};
    for(const username in userMap){
        const userInformation = userMap[username];
        let company = "-Unknown-";
        if(userInformation.profile.company){
            company = userInformation.profile.company.trim().toLowerCase();
            if(company.startsWith("@")){
                company = company.substring(1);
            }
        } else{
            company = "-Unknown-";
        }
        companyMap[company] = companyMap[company] ?? {
            name: company,
            numberOfUsers: 0,
            sumOfScores: 0,
            contributionScoresPerRepository: {},
        };
        companyMap[company].numberOfUsers++;
        companyMap[company].sumOfScores += userInformation.score;
        for(const repoNameWithOwner in userInformation.contributionScoresPerRepository){
            companyMap[company].contributionScoresPerRepository[repoNameWithOwner] = (companyMap[company].contributionScoresPerRepository[repoNameWithOwner] ?? 0) + userInformation.contributionScoresPerRepository[repoNameWithOwner];
        }
    }
    // sort the companyMap by number of users
    const companyMapEntries = Object.entries(companyMap);
    companyMapEntries.sort((a, b) => b[1].numberOfUsers - a[1].numberOfUsers);
    const sortedCompanyMap:{[companyName:string]:CompanyInformation} = {};
    for (const companyMapEntry of companyMapEntries) {
        sortedCompanyMap[companyMapEntry[0]] = companyMapEntry[1];
    }
    return sortedCompanyMap;
}
