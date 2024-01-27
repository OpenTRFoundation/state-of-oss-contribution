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
import {header, log} from "../util/log.js";

export interface Config {
    reportDataTruthMapDirectory:string;
    outputDirectory:string;
}

const USER_SCORE_COEFFICIENTS = {
    // PRs are the most important, as in the end, this is what the most impactful contributions are
    // in a proper open source project
    PullRequest: 60,
    // reviews are also important, as they are a sign of a more advanced contributor
    PullRequestReview: 30,
    // commits are not very important, as they're included in the PRs.
    // also, giving a high score for commits would favor people who just push their own commits to their own repos
    Commit: 1,
    // issues are also important
    Issue: 9,
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
    sumOfScores:number;
    contributedFocusOrgCount:number;
    contributionDiversityMultiplier:number;
    score:number;
    stats:UserStats;
    contributionScoresPerRepository:{[repoNameWithOwner:string]:number};
}

interface CompanyInformation {
    name:string;
    contributionScoresPerRepository:{[repoNameWithOwner:string]:number};
    sumOfUserScores:number;
    score:number;

    numberOfUsers:number;
    userDiversityMultiplier:number;

    contributedFocusOrgCount:number;
    contributionDiversityMultiplier:number;
}

export async function main(config:Config) {
    // read truth maps
    header(`Reading focus repository truth map...`);
    const focusRepositories:{ [nameWithOwner:string]:RepositorySummaryFragment } = readPartitioned(config.reportDataTruthMapDirectory, "truth-map-focus-repositories.index.json");

    header(`Reading focus organization truth map...`);
    const focusOrganizations:{ [orgName:string]:FocusOrganization } = readPartitioned(config.reportDataTruthMapDirectory, "truth-map-focus-organizations.index.json");

    header(`Reading user and contrib search truth map...`);
    const userAndContribSearchTruthMap:{ [username:string]:TaskRunOutputItem[] } = readPartitioned(config.reportDataTruthMapDirectory, "truth-map-user-and-contrib.index.json");

    header(`Reading user locations truth map...`);
    const userLocationsTruthMap:{ [username:string]:UserLocation } = readPartitioned(config.reportDataTruthMapDirectory, "truth-map-user-locations.index.json");

    header(`Building all focus repositories score map...`);
    const allFocusRepositoriesScoreMap = buildAllFocusRepositoriesScoreMap(focusOrganizations, focusRepositories);

    header(`Building focus organization score map...`);
    const focusOrganizationScoreMap = buildFocusOrganizationScoreMap(allFocusRepositoriesScoreMap);

    header(`Building focus repository score map...`);
    const focusRepositoryScoreMap = buildFocusRepositoryScoreMap(focusRepositories, allFocusRepositoriesScoreMap);



    header(`Building user information map...`);
    const userInformationMap = buildUserInformationMap(userAndContribSearchTruthMap, userLocationsTruthMap);

    header(`Building active user information map...`);
    const activeUserInformationMap = buildActiveUserInformationMap(userInformationMap);

    header(`Building OSS contributor information map...`);
    const ossContributorInformationMap = buildOssContributorInformationMap(activeUserInformationMap, allFocusRepositoriesScoreMap);

    header(`Building company OSS contribution information map...`);
    const companyOssContributionInformationMap = buildCompanyInformationMap(ossContributorInformationMap, allFocusRepositoriesScoreMap);

    header(`Building user province counts map...`);
    const userProvinceCountsMap = buildUserProvinceCountsMap(userInformationMap);

    header(`Building active user province counts map...`);
    const activeUserProvinceCountsMap = buildUserProvinceCountsMap(activeUserInformationMap);

    header(`Building OSS contributor province counts map...`);
    const ossContributorProvinceCountsMap = buildUserProvinceCountsMap(ossContributorInformationMap);

    header(`Building user signed up at map...`);
    const userSignedUpAtMap = buildUserSignedUpAtMap(userInformationMap);

    header(`Building contributed focus organization contribution score map...`);
    const contributedFocusOrgContributionScoreMap = buildContributedFocusOrganizationContributionScoreMap(userInformationMap, ossContributorInformationMap, focusOrganizations);

    header(`Building active user leader board...`);
    const activeUserLeaderBoard = buildLeaderBoard(activeUserInformationMap);

    header(`Building OSS contributor leader board...`);
    const ossContributorLeaderBoard = buildLeaderBoard(ossContributorInformationMap);

    header(`Building company leader board...`);
    const companyLeaderBoard = buildLeaderBoard(companyOssContributionInformationMap);

    header(`Writing output files...`);
    fs.writeFileSync(join(config.outputDirectory, "110-focus-organization-score-map.json"), JSON.stringify(focusOrganizationScoreMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "120-focus-repository-score-map.json"), JSON.stringify(focusRepositoryScoreMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "210-user-province-counts-map.json"), JSON.stringify(userProvinceCountsMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "220-active-user-province-counts-map.json"), JSON.stringify(activeUserProvinceCountsMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "230-oss-contributor-province-counts-map.json"), JSON.stringify(ossContributorProvinceCountsMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "240-user-signed-up-at-map.json"), JSON.stringify(userSignedUpAtMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "310-active-user-leader-board.json"), JSON.stringify(activeUserLeaderBoard, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "320-oss-contributor-leader-board.json"), JSON.stringify(ossContributorLeaderBoard, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "330-company-oss-contribution-leader-board.json"), JSON.stringify(companyLeaderBoard, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "400-contributed-focus-organization-contribution-score-map.json"), JSON.stringify(contributedFocusOrgContributionScoreMap, null, 2));

    // DEBUG
    fs.writeFileSync(join(config.outputDirectory, "debug-user-information-map.json"), JSON.stringify(userInformationMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "debug-active-user-information-map.json"), JSON.stringify(activeUserInformationMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "debug-oss-contributor-information-map.json"), JSON.stringify(ossContributorInformationMap, null, 2));
    fs.writeFileSync(join(config.outputDirectory, "debug-company-oss-contribution-map.json"), JSON.stringify(companyOssContributionInformationMap, null, 2));
}

/**
 * Builds a map of the focus repository names (with owner) to the score of the repository.
 * The focus repositories are:
 * - the focus repositories that are not part of an organization (these have higher selection criteria)
 * - all repositories of the focus organizations
 *
 * Score calculation is somewhat complex, see the calculateRepositoryScore function for details.
 *
 * @see calculateRepositoryScore
 * @param focusOrganizations
 * @param focusRepositories
 */
function buildAllFocusRepositoriesScoreMap(focusOrganizations:{[orgName:string]:FocusOrganization}, focusRepositories:{[nameWithOwner:string]:RepositorySummaryFragment}) {
    log(`Calculating repository scores...`);

    const scoreMap:{ [nameWithOwner:string]:number } = {};

    for (const focusRepo of Object.values(focusRepositories)) {
        const nameWithOwner = focusRepo.nameWithOwner;
        scoreMap[nameWithOwner] = calculateRepositoryScore(focusRepo, 0);
    }

    for(const focusOrg of Object.values(focusOrganizations)){
        for(const focusRepo of Object.values(focusOrg.repositories)){
            const nameWithOwner = focusRepo.nameWithOwner;
            scoreMap[nameWithOwner] = calculateRepositoryScore(focusRepo, focusOrg.numberOfMatchingRepositories);
        }
    }

    // TODO: create a reusable function for this sorting
    // sort scoreMap by score
    // Javascript objects cannot be sorted for sure (we migth end up with numeric repository names at the top), but it is ok.
    const scoreMapEntries = Object.entries(scoreMap);
    scoreMapEntries.sort((a, b) => b[1] - a[1]);
    const sortedScoreMap:{ [nameWithOwner:string]:number } = {};
    for (const scoreMapEntry of scoreMapEntries) {
        sortedScoreMap[scoreMapEntry[0]] = scoreMapEntry[1];
    }

    log(`Found ${Object.keys(sortedScoreMap).length} focus repositories.`);

    return sortedScoreMap;
}

/**
 * Builds a map of the focus organization name to the score of the organization.
 *
 * The focus repositories (which are not part of an organization) are also included in this map, with the user
 * owning the repository as the organization.
 *
 * The score of the organization is the sum of the scores of the repositories of the organization.
 *
 * @param focusRepositoriesScoreMap
 */
function buildFocusOrganizationScoreMap(focusRepositoriesScoreMap:{ [nameWithOwner:string]:number }) {
    log(`Calculating organization scores...`);

    const scoreMap:{ [org:string]:number } = {};

    for (const repoNameWithOwner of Object.keys(focusRepositoriesScoreMap)) {
        const orgName = repoNameWithOwner.split("/")[0];
        scoreMap[orgName] = (scoreMap[orgName] ?? 0) + focusRepositoriesScoreMap[repoNameWithOwner];
    }

    // TODO: create a reusable function for this sorting
    // sort scoreMap by score
    // Javascript objects cannot be sorted for sure (we migth end up with numeric org names at the top), but it is ok.
    const scoreMapEntries = Object.entries(scoreMap);
    scoreMapEntries.sort((a, b) => b[1] - a[1]);
    const sortedScoreMap:{ [org:string]:number } = {};
    for (const scoreMapEntry of scoreMapEntries) {
        sortedScoreMap[scoreMapEntry[0]] = scoreMapEntry[1];
    }

    log(`Found ${Object.keys(sortedScoreMap).length} focus organizations.`);

    return sortedScoreMap;
}

/**
 * Builds a map of the focus repository name (with owner) to the score of the repository.
 *
 * However, only includes the repositories that are not part of any organizations.
 *
 * @param focusRepositories
 * @param allFocusRepositoriesScoreMap
 */
function buildFocusRepositoryScoreMap(focusRepositories:{[nameWithOwner:string]:RepositorySummaryFragment}, allFocusRepositoriesScoreMap:{[nameWithOwner:string]:number}) {
    log(`Building focus repository score map...`);

    const output:{[nameAndOwner:string]:number} = {};
    for(const repoName in focusRepositories){
        if(allFocusRepositoriesScoreMap[repoName]){
            output[repoName] = allFocusRepositoriesScoreMap[repoName];
        }
    }

    // TODO: create a reusable function for this sorting
    // sort the output by score
    const outputEntries = Object.entries(output);
    outputEntries.sort((a, b) => b[1] - a[1]);
    const sortedOutput:{[nameAndOwner:string]:number} = {};
    for (const outputEntry of outputEntries) {
        sortedOutput[outputEntry[0]] = outputEntry[1];
    }

    log(`Found ${Object.keys(sortedOutput).length} focus repositories.`);

    return sortedOutput;
}

/**
 * Builds a map of the username to the user information.
 *
 * At this point, all contributions are included, not just contributions to the focus projects.
 *
 * Part of the user information, we also calculate the contribution score for each repository for the user, as well as
 * the total contribution score.
 *
 * At this stage, we don't care about the focus projects, so the contribution score for each repository is simply the
 * sum of the contribution scores for each contribution type. The repository score is also discarded.
 *
 * Each contribution type has a different coefficient, which is hardcoded in the USER_SCORE_COEFFICIENTS object.
 * Also, the contribution count is normalized with sqrt, so that the contribution count is not too dominant.
 *
 * So, basically, these scores are basically user's "activity score" with no regards to the focus projects, repository
 * scores or contribution diversity.
 *
 * Total contribution score is the sum of the contribution scores for each repository.
 *
 * @param userAndContribSearchTruthMap
 * @param userLocationsTruthMap
 */
function buildUserInformationMap(userAndContribSearchTruthMap:{ [username:string]:TaskRunOutputItem[] }, userLocationsTruthMap:{ [username:string]:UserLocation }) {
    log(`Building user information...`);

    const userInformationMap:{ [username:string]:UserInformation } = {};

    function processContributions(contribScores:{[repoNameWithOwner:string]:number}, coefficient:number, contributions:ContributionByRepositoryFragment[]) {
        for(const contribution of contributions){
            const repoName = contribution.repository.nameWithOwner;

            // the score for the repo contribution depends on:
            // - contribution count (normalized)
            // - kind of contribution (coefficient)
            // later on, other factors are added, but at this stage, we simply calculate the contribution score for the repo

            const contribCount = contribution.contributions.totalCount;
            // normalize the contribution count with sqrt.
            // when a user sends 100 prs and another user sends 10 prs, we don't want the first user to have 10x the score.
            // however, sqrt(100) = 10 and sqrt(10) = 3.16, so the first user will have 3.16x the score; which is more fair.
            const normalizedContribCount = Math.sqrt(contribCount);

            if(!contribScores[repoName]){
                contribScores[repoName] = 0;
            }

            contribScores[repoName] = contribScores[repoName] + normalizedContribCount * coefficient;
            contribScores[repoName] = Math.floor(contribScores[repoName]);
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
            // in this case, we don't care about the repository score or the contribution diversity, as we're not filtering by the focus projects
            score += contribScores[repoNameWithOwner];
        }

        if(!profile || !stats){
            continue;
        }

        userInformationMap[username] = {
            profile: profile,
            sumOfScores: score,
            contributedFocusOrgCount: 0,
            contributionDiversityMultiplier: 1,
            score: score,
            stats: stats,
            contributionScoresPerRepository: sortedContribScores,
        };
    }

    log(`Found ${Object.keys(userInformationMap).length} users.`);

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
    log(`Building active user information...`);

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

    log(`Found ${Object.keys(activeUserInformationMap).length} active users.`);

    return activeUserInformationMap;
}

/**
 * Builds a map of the username to the user information for the users that contributed to the focus projects.
 *
 * Creates a new user information map, where the contributions are filtered to only include contributions to the focus projects.
 *
 * Also, the score is computed using various factors:
 * - contribution count (normalized): this is already done in the previous steps and given as parameter
 * - repository score multiplier: the score of the repository, multiplied by 1 + 5% of the repository score
 * - contributed organization diversity: this is the number of focus organizations that the user contributed to
 * - final score normalization: the final score is normalized with sqrt, so that the top scores are not too high
 *
 * Score built this way is called the "OSS contribution score" and is not comparable to the "activity score" calculated earlier.
 *
 * @param userInformationMap
 * @param focusRepositoriesScoreMap
 */
function buildOssContributorInformationMap(userInformationMap:{[username:string]:UserInformation}, focusRepositoriesScoreMap:{[orgNameWithOwner:string]:number}) {
    log(`Building OSS contributor information...`);

    const ossContributorInformationMap:{ [username:string]:UserInformation } = {};

    for(const username in userInformationMap) {
        const userInformation = userInformationMap[username];
        const userOssContribScoresPerRepos:{[repoNameWithOwner:string]:number} = {};

        let sumOfScores = 0;

        // we're gonna need the list of contributed organizations later on to find out the contribution diversity
        const contributedOrgs = new Set<string>();
        for(const repoNameWithOwner in userInformation.contributionScoresPerRepository){
            if(focusRepositoriesScoreMap[repoNameWithOwner]){
                const userContribScoreForRepository = userInformation.contributionScoresPerRepository[repoNameWithOwner];

                const repoScore = focusRepositoriesScoreMap[repoNameWithOwner];
                // pass this value as is
                userOssContribScoresPerRepos[repoNameWithOwner] = userContribScoreForRepository;

                // repo score multiplier is 1 + 5% of the repo score.
                // this is to make sure that the repo score is not too dominant.
                const repoScoreMultiplier = 1 + repoScore * 0.05;
                const userRepoScore = userContribScoreForRepository * repoScoreMultiplier;
                // add up the total OSS contribution score
                sumOfScores += userRepoScore;

                const orgName = repoNameWithOwner.split("/")[0];
                contributedOrgs.add(orgName);
            }
        }

        sumOfScores = Math.floor(sumOfScores);

        // add a multiplier for contributed organization diversity
        const contributionDiversityMultiplier = 1 + contributedOrgs.size * 0.25;
        let userTotalOssContributionScore = sumOfScores * contributionDiversityMultiplier;

        // normalize the score with sqrt, otherwise the top scores will be too high
        userTotalOssContributionScore = Math.sqrt(userTotalOssContributionScore);
        userTotalOssContributionScore = Math.floor(userTotalOssContributionScore);

        if(userTotalOssContributionScore < OSS_CONTRIBUTOR_MIN_SCORE){
            continue;
        }

        ossContributorInformationMap[username] = {
            // same
            profile: userInformation.profile,
            stats: userInformation.stats,

            //different
            sumOfScores: sumOfScores,
            contributedFocusOrgCount: contributedOrgs.size,
            contributionDiversityMultiplier: contributionDiversityMultiplier,
            score: userTotalOssContributionScore,
            contributionScoresPerRepository: userOssContribScoresPerRepos,
        };
    }

    // TODO: create a reusable function for this sorting
    // sort the output by score
    const outputEntries = Object.entries(ossContributorInformationMap);
    outputEntries.sort((a, b) => b[1].score - a[1].score);
    const sortedOutput:{[username:string]:UserInformation} = {};
    for (const outputEntry of outputEntries) {
        sortedOutput[outputEntry[0]] = outputEntry[1];
    }

    log(`Found ${Object.keys(sortedOutput).length} OSS contributors.`);

    return sortedOutput;
}

/**
 * Builds a map of provinces and the number of users in that province.
 *
 * @param userInformationMap
 */
function buildUserProvinceCountsMap(userInformationMap:{ [username:string]:UserInformation }) {
    log(`Building user province counts...`);

    const userProvinceCountsMap:{ [province:string]:number } = {};

    for(const username in userInformationMap){
        const userInformation = userInformationMap[username];
        const province = userInformation.profile.province ?? UNKNOWN_PROVINCE;
        userProvinceCountsMap[province] = (userProvinceCountsMap[province] ?? 0) + 1;
    }

    // TODO: create a reusable function for this sorting
    // sort the output by number of users
    const outputEntries = Object.entries(userProvinceCountsMap);
    outputEntries.sort((a, b) => b[1] - a[1]);
    const sortedOutput:{[province:string]:number} = {};
    for (const outputEntry of outputEntries) {
        sortedOutput[outputEntry[0]] = outputEntry[1];
    }

    log(`Found ${Object.keys(sortedOutput).length} provinces.`);

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
    log(`Building user signed up at map...`);

    const signedUpAtMap:{[year:string]:number} = {};
    for(const username in userInformationMap){
        const userInformation = userInformationMap[username];
        const year = userInformation.profile.signedUpAt.substring(0, 4);
        signedUpAtMap[year] = (signedUpAtMap[year] ?? 0) + 1;
    }

    log(`Found ${Object.keys(signedUpAtMap).length} years.`);

    return signedUpAtMap;
}

/**
 * Builds a map of the focus organization name to the contribution score of the organization.
 * Contribution score is the sum of the contribution scores of the OSS contributors for that organization.
 * @param userInformationMap
 * @param ossContributorInformationMap
 * @param focusOrganizations
 */
function buildContributedFocusOrganizationContributionScoreMap(userInformationMap:{[userName:string]:UserInformation}, ossContributorInformationMap:{[userName:string]:UserInformation}, focusOrganizations:{[name:string]:FocusOrganization}) {
    // we need
    // - userInformationMap: it contains contribution scores for each user, without the repo score and other multipliers
    // - ossContributorInformationMap: to check if a user is an OSS contributor
    // - focusOrganizations: to check if an organization is a focus organization

    log(`Building contributed focus organization contribution score map...`);

    const output:{[orgName:string]:number} = {};
    for(const userName in userInformationMap){
        const userInformation = userInformationMap[userName];
        if(!ossContributorInformationMap[userName]){
            continue;
        }
        for(const repoNameWithOwner in userInformation.contributionScoresPerRepository){
            const orgName = repoNameWithOwner.split("/")[0];
            if(!focusOrganizations[orgName]){
                continue;
            }
            output[orgName] = (output[orgName] ?? 0) + userInformation.contributionScoresPerRepository[repoNameWithOwner];
        }
    }

    // TODO: create a reusable function for this sorting
    // sort the output by score
    const outputEntries = Object.entries(output);
    outputEntries.sort((a, b) => b[1] - a[1]);
    const sortedOutput:{[orgName:string]:number} = {};
    for (const outputEntry of outputEntries) {
        sortedOutput[outputEntry[0]] = outputEntry[1];
    }

    log(`Found ${Object.keys(sortedOutput).length} contributed focus organizations.`);
    return sortedOutput;
}

interface Scored{
    score:number;
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
 * @param scoredMap
 */
function buildLeaderBoard<T extends Scored>(scoredMap:{ [username:string]:T }) {
    log(`Building scored leader board...`);

    const list:T[] = [];

    // Javascript objects cannot be sorted.
    // So, we need to get the keys, sort them by user score, and then iterate over the keys.

    const usernames = Object.keys(scoredMap);
    usernames.sort((a, b) => scoredMap[b].score - scoredMap[a].score);

    // get the top N
    for(let i = 0; i < LEADER_BOARD_SIZE && i < usernames.length; i++){
        list.push(scoredMap[usernames[i]]);
    }

    log(`Found ${list.length} scored items in the leader board.`);

    return list;
}

/**
 * Builds a map of the company name to the company information.
 *
 * The score is calculated based on the user information map and the focus repositories score map.
 *
 * There are a few factors that are taken into account:
 * - sum of the scores of the users in the company
 * - number of users in the company
 * - number of contributed organizations by the users in the company
 *
 * Example:
 * {
 *    "foo": {
 *     "name": "foo",
 *     "numberOfUsers": 3,
 *     "sumOfScores": 3147,
 *     ...
 *   },
 *   ...
 * }
 *
 * @param userMap
 * @param focusRepositoriesScoreMap
 */
function buildCompanyInformationMap(userMap:{ [p:string]:UserInformation }, focusRepositoriesScoreMap:{[orgNameWithOwner:string]:number}) {
    log(`Building company information map...`);

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
        if (!companyMap[company]) {
            companyMap[company] = {
                name: company,
                contributionScoresPerRepository: {},
                sumOfUserScores: 0,
                score: 0,

                numberOfUsers: 0,
                userDiversityMultiplier: 1,

                contributedFocusOrgCount: 0,
                contributionDiversityMultiplier: 1,
            };
        }
        companyMap[company].numberOfUsers++;
        companyMap[company].sumOfUserScores += userInformation.score;
        for(const repoNameWithOwner in userInformation.contributionScoresPerRepository){
            companyMap[company].contributionScoresPerRepository[repoNameWithOwner] = (companyMap[company].contributionScoresPerRepository[repoNameWithOwner] ?? 0) + userInformation.contributionScoresPerRepository[repoNameWithOwner];
        }
    }

    log(`Building company scores...`);
    // add a multiplier for the number of contributed repositories of users in the company
    for(const company of Object.values(companyMap)){
        const contributedOrgs = new Set<string>();
        for(const repoNameWithOwner in company.contributionScoresPerRepository){
            if(focusRepositoriesScoreMap[repoNameWithOwner]){
                const orgName = repoNameWithOwner.split("/")[0];
                contributedOrgs.add(orgName);
            }
        }

        company.contributedFocusOrgCount = contributedOrgs.size;
        company.contributionDiversityMultiplier = 1 + contributedOrgs.size * 0.25;

        company.userDiversityMultiplier = 1 + company.numberOfUsers * 0.25;

        company.score = company.sumOfUserScores * company.userDiversityMultiplier * company.contributionDiversityMultiplier;
        company.score = Math.floor(company.score);
    }

    // TODO: create a reusable function for this sorting
    // sort the companyMap by the scores of companies
    const companyMapEntries = Object.entries(companyMap);
    companyMapEntries.sort((a, b) => b[1].score - a[1].score);
    const sortedCompanyMap:{[companyName:string]:CompanyInformation} = {};
    for (const companyMapEntry of companyMapEntries) {
        sortedCompanyMap[companyMapEntry[0]] = companyMapEntry[1];
    }

    log(`Found ${Object.keys(sortedCompanyMap).length} companies.`);

    return sortedCompanyMap;
}

/**
 * Calculates the score of a repository.
 *
 * The score is calculated based on the repository summary fragment, and the number of matched repositories in the
 * organization.
 *
 * The score is calculated based on the following factors, which have different weight.
 * - fork count
 * - stargazer count
 * - pull request count
 * - issue count
 * - watcher count
 * - number of matched repositories in the organization
 *
 * The score is normalized with sqrt, so that the top scores are not too high.
 * This is done because often the factors above are correlated.
 *
 * @param repo
 * @param numberOfMatchedRepositoriesInOrg
 */
function calculateRepositoryScore(repo:RepositorySummaryFragment, numberOfMatchedRepositoriesInOrg:number) {
    // the weights should sum up to 100 for an easy-to-understand score

    let pureRepoScore = 0;
    pureRepoScore += repo.forkCount * 5;
    pureRepoScore += repo.stargazerCount * 20;
    pureRepoScore += repo.pullRequests.totalCount * 20;
    pureRepoScore += repo.issues.totalCount * 40;
    // TODO?
    // score += repo.mentionableUsers.totalCount * 30;
    pureRepoScore += repo.watchers.totalCount * 10;
    // TODO
    //score += repo.discussions.totalCount * 5;

    if (!pureRepoScore) {
        return 0;
    }

    // normalize the score with sqrt.
    // when a repo has 100 stars and another repo has 10 stars, we don't want the first repo to have 10x the score.
    // however, sqrt(100) = 10 and sqrt(10) = 3.16, so the first repo will have 3.16x the score; which is more fair.
    const normalizedRepoScore = Math.sqrt(pureRepoScore);
    if (normalizedRepoScore <= 0) {
        return 0;
    }

    // add a multiplier for the number of matched repositories in the organization
    const orgMultiplier = 1 + Math.sqrt(numberOfMatchedRepositoriesInOrg) * 0.01;
    const repoScoreWithOrgMultiplier = normalizedRepoScore * orgMultiplier;

    return Math.floor(repoScoreWithOrgMultiplier);
}
