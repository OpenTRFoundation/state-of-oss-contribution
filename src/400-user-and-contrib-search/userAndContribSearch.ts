import {dirname, join} from "path";
import {fileURLToPath} from "url";
import {Command} from "@opentr/cuttlecat/dist/graphql/command.js";
import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import {Task} from "@opentr/cuttlecat/dist/graphql/task.js";
import {TaskResult} from "@opentr/cuttlecat/dist/graphql/taskResult.js";
import {TaskRunOutputItem} from "@opentr/cuttlecat/dist/graphql/taskRunOutputItem.js";
import {TaskSpec} from "@opentr/cuttlecat/dist/graphql/taskSpec.js";
import {ProcessState} from "@opentr/cuttlecat/dist/subcommand/execute.js";
import {ProcessFileHelper} from "@opentr/cuttlecat/dist/processFileHelper.js";
import {
    addDays,
    daysInPeriod,
    formatDate,
    formatISOTimeStampIgnoreTimezone,
    parseDate,
    readSlurpJsonFileSync,
    splitPeriodIntoHalves,
    splitPeriodIntoParts,
    subtractDays
} from "@opentr/cuttlecat/dist/utils.js";
import {endOfDay, isAfter, startOfDay} from "date-fns";
import {v4 as uuidv4} from "uuid";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * This task search for users and their contributions.
 *
 * The search criteria are:
 * - minRepositories: minimum number of repositories
 * - minFollowers: minimum number of followers
 * - excludeUsersSignedUpBefore: exclude users who signed up before this date
 * - minUserAge: minimum number of days since user was signed up; ignore users who signed up after this date
 * - contribMaxAge: start date of the date range to search for user contributions. The task will search for contributions between this [now()-contribMaxAge, now()-contribMinAge].
 * - contribMinAge: end date of the date range to search for user contributions. The task will search for contributions between this [now()-contribMaxAge, now()-contribMinAge].
 *
 * IMPORTANT:
 * - Given GitHub token must have 'user:email' and 'read:user' scopes.
 *
 * Example #1:
 * "--user-count-per-location-files-dir=/path",
 * Use the JSON files from the given the directory that contains user counts per location. Search will be done for the locations that has some users in it.
 * Also, the user count in a location will help with the batch size to avoid making search calls that take huge amount of time.
 *
 * Example #2:
 * "--exclude-users-signed-up-before=2008-01-01 --min-user-age=365"
 * Fetch users who signed up between 2008-01-01 and 365 days ago.
 *
 * Example #3:
 * "--search-period-in-days-for-10000-users=5",
 * For each location, use a max date range length of <5*10000/userCount> in one call.
 * Assume these parameters: --exclude-users-signed-up-before=2010-01-01 --min-user-age=365.
 * Also assume today is 2021-01-01.
 * The user sign-up date range to search for will be [2010-01-01, 2020-01-01] and will have a length of 10 years (~3650 days).
 * For example, if there are 1 user in location A, 100 users in location B, 1000 users in location C and 100000 users in location D, users in those locations will be fetched like this:
 * A: Date range length = ceil(5*10000/1) = 50000, ceil(3650/50000) = 1 calls ---
 * B: Date range length = ceil(5*10000/100) = 500, ceil(3650/500) = 8 calls ---
 * C: Date range length = ceil(5*10000/1000) = 50, ceil(3650/50) = 73 calls ---
 * D: Date range length = ceil(5*10000/100000) = 1, ceil(3650/1) = 3650 calls. ---
 * Even when the user count information is not collected with the same criteria (min followers, min repositories, etc.),
 * that count gives an idea of how many users will be in a location that information can be used to generalize.
 * Please note that these are _initial_ calls. If there are more users than the page size, subsequent calls will be made.
 * Similarly, contrib search will be split into smaller date ranges and this will also affect the number of calls as both
 * user search and contribution search are done at the same time in one call.
 *
 * Example #4:
 * "--page-size=100"
 * Fetch max 100 users in one call. Combined with other options that might affect the batch size, things can get complicated.
 * However, this option will help to avoid making search calls that take huge amount of time and also avoid GitHub API timeouts.
 * Lowering the page size will not solve all problems! Even when one uses a page size of 1, GitHub API may time out when using large date ranges because it needs
 * to search through a lot of data and only return 1 result.
 *
 * Example #5:
 * "--contrib-max-age=365 --contrib-min-age=0 --contrib-search-period-parts=2"
 * Assume -search-period-in-days-for-10000-users=365 and --exclude-users-signed-up-before=2010-01-01 --min-user-age=365 and today is 2012-01-01.
 * Then the process will only have a single date range for user sign up date range: [2010-01-01, 2011-01-01]. If --contrib-search-period-parts was 1
 * the whole contribution search would be done in one call. However, since it is 2, the contribution search would be split into 2 parts and each part would be searched separately.
 * So, these will be the queries:
 * 1. Get users who signed up between 2010-01-01 and 2011-01-01 and find their contributions between 2011-01-01 and 2011-07-01.
 * 2. Get users who signed up between 2010-01-01 and 2011-01-01 and find their contributions between 2011-07-01 and 2012-01-01.
 * This split will help with 2 things: getting more results (GitHub API returns max 100 contributed repositories) and avoiding GitHub API timeouts.
 * However, it is advised to search for contributions for a short range. For example, for user contributions in last 6 months.
 *
 * Example #6:
 * "--min-repositories=50 --min-followers=50"
 * Find users that have at least 50 followers and 50 repositories.
 */


export interface UserAndContribSearchConfig {
    // ------ CRITERIA - described above --------
    minRepositories:number;
    minFollowers:number;
    excludeUsersSignedUpBefore:string;
    minUserAge:number;
    contribMaxAge:number;
    contribMinAge:number;

    // ------ SEARCH tuning --------
    userCountPerLocationFilesDir:string;
    searchPeriodInDaysFor10000Users:number;
    contribSearchPeriodParts:number;
    pageSize:number;
}

const DEFAULT_CONFIG:UserAndContribSearchConfig = {
    // ------ CRITERIA - described above --------
    minRepositories: 1,
    minFollowers: 0,
    excludeUsersSignedUpBefore: "2008-01-01",
    minUserAge: 0,
    contribMaxAge: 365,
    contribMinAge: 0,

    // ------ SEARCH tuning --------
    // Path to the directory that contains files with user counts per location. Search will be done for the locations
    // that has some users in it. Also, the number of users in a location will help with
    // the batch size to avoid making search calls that take huge amount of time.
    userCountPerLocationFilesDir: join(__dirname, "..", "..", "..", "300-user-count-search"),

    // Length of the search date range per 10000 users to search for users for a location in one call.
    searchPeriodInDaysFor10000Users: 5,
    // The contrib search will be split into this many parts. Since GitHub API returns max 100 repositories for
    // finding contributions between a date range, this option will help to split the search into smaller date ranges.
    // Must be a power of 2.
    // TODO: 1, really?
    contribSearchPeriodParts: 1,

    // Maximum number of users to find in one call
    pageSize: 100,
};

export interface UserSearchRepositoryIdFragment {
    nameWithOwner:string;
    isInOrganization:boolean;
    owner:{
        login:string;
    };
}

export interface UserAndContribSearchResultFragment {
    login:string;
    company:string | null;
    name:string | null;
    createdAt:any;
    email:string;
    location:string | null;
    twitterUsername:string | null;
    websiteUrl:any | null;
    followers:{
        totalCount:number;
    };
    gists:{
        totalCount:number;
    };
    issueComments:{
        totalCount:number;
    };
    issues:{
        totalCount:number;
    };
    pullRequests:{
        totalCount:number;
    };
    repositories:{
        totalCount:number;
    };
    repositoriesContributedTo:{
        totalCount:number;
    };
    repositoryDiscussionComments:{
        totalCount:number;
    };
    repositoryDiscussions:{
        totalCount:number;
    };
    socialAccounts:{
        edges:{
            node:{
                displayName:string;
                provider:string;
                url:any;
            };
        }[];
    };
    sponsoring:{
        totalCount:number;
    };
    sponsors:{
        totalCount:number;
    };
    contributionsCollection:{
        startedAt:any;
        endedAt:any;
        totalIssueContributions:number;
        totalCommitContributions:number;
        totalPullRequestContributions:number;
        totalPullRequestReviewContributions:number;
        totalRepositoriesWithContributedIssues:number;
        totalRepositoriesWithContributedCommits:number;
        totalRepositoriesWithContributedPullRequests:number;
        totalRepositoriesWithContributedPullRequestReviews:number;
        issueContributionsByRepository:{
            contributions:{
                totalCount:number;
            };
            repository:{
                nameWithOwner:string;
                isInOrganization:boolean;
                owner:{
                    login:string;
                };
            };
        };
        commitContributionsByRepository:{
            contributions:{
                totalCount:number;
            };
            repository:UserSearchRepositoryIdFragment;
        };
        pullRequestContributionsByRepository:{
            contributions:{
                totalCount:number;
            };
            repository:UserSearchRepositoryIdFragment;
        };
        pullRequestReviewContributionsByRepository:{
            contributions:{
                totalCount:number;
            };
            repository:UserSearchRepositoryIdFragment;
        };
    };
}

export interface UserAndContribSearchTaskResult extends TaskResult {
    search:{
        pageInfo:{
            startCursor:string | null;
            hasNextPage:boolean;
            endCursor:string | null;
        };
        userCount:number,
        nodes:UserAndContribSearchResultFragment[];
    };
}

export interface UserAndContribSearchTaskSpec extends TaskSpec {
    location:string;
    signedUpAfter:string;
    signedUpBefore:string;
    minRepositories:number;
    minFollowers:number;
    contribFromDate:string;
    contribToDate:string;
    pageSize:number;
    startCursor:string | null;
}

export default class UserAndContribSearchCommand implements Command<UserAndContribSearchTaskResult, UserAndContribSearchTaskSpec, UserAndContribSearchTask> {
    private readonly config:UserAndContribSearchConfig;
    private readonly nowFn:() => Date;

    constructor(config?:UserAndContribSearchConfig, nowFn?:() => Date) {
        this.config = config ?? DEFAULT_CONFIG;
        this.nowFn = nowFn ?? (() => new Date());
    }

    createTask(_:TaskContext, spec:UserAndContribSearchTaskSpec):UserAndContribSearchTask {
        return new UserAndContribSearchTask(spec);
    }

    createNewQueueItems(context:TaskContext):UserAndContribSearchTaskSpec[] {
        if (this.config.userCountPerLocationFilesDir == null) {
            throw new Error("userCountPerLocationFilesDir is required");
        }
        const userCountSearchProcessFileHelper = new ProcessFileHelper(this.config.userCountPerLocationFilesDir);
        const userCountSearchLatestProcessStateDirectory = userCountSearchProcessFileHelper.getLatestProcessStateDirectory();
        if (!userCountSearchLatestProcessStateDirectory) {
            throw new Error("No latest user count search process state directory found");
        }

        const userCountSearchProcessState:ProcessState = userCountSearchProcessFileHelper.readProcessStateFile(userCountSearchLatestProcessStateDirectory);
        if (userCountSearchProcessState == null) {
            throw new Error("Latest user count search process state is null");
        }
        if (userCountSearchProcessState.completionDate == null) {
            throw new Error("Latest user count search process state is not complete");
        }

        const locations:{ [key:string]:number } = {};

        const userCountSearchProcessOutputFiles = userCountSearchProcessFileHelper.getProcessOutputFiles(userCountSearchLatestProcessStateDirectory);
        for (const userCountSearchProcessOutputFile of userCountSearchProcessOutputFiles) {
            const filePath = join(this.config.userCountPerLocationFilesDir, userCountSearchLatestProcessStateDirectory, userCountSearchProcessOutputFile);
            const locationFileEntries:TaskRunOutputItem[] = readSlurpJsonFileSync(filePath);

            locationFileEntries.forEach((entry) => {
                if (entry.result.userCount < 1) {
                    return;
                }
                locations[entry.result.location] = entry.result.userCount;
            });
        }


        const signupStartDate = parseDate(this.config.excludeUsersSignedUpBefore);
        const signupEndDate = subtractDays(this.nowFn(), this.config.minUserAge);

        const contribStartDate = subtractDays(this.nowFn(), this.config.contribMaxAge);
        const contribEndDate = subtractDays(this.nowFn(), this.config.contribMinAge);

        const contribSearchRanges = splitPeriodIntoParts(contribStartDate, contribEndDate, this.config.contribSearchPeriodParts);

        context.logger.info(
            `Creating a new process state: ` +
            `startDate: ${formatDate(signupStartDate)}, endDate: ${formatDate(signupEndDate)}, ` +
            `contribStartDate: ${formatDate(contribStartDate)}, contribEndDate: ${formatDate(contribEndDate)}`
        );

        const newTaskSpecs:UserAndContribSearchTaskSpec[] = [];

        // create tasks for each location + signup date range + contrib search date range
        for (const location of Object.keys(locations)) {
            const searchPeriodInDays = Math.ceil(this.config.searchPeriodInDaysFor10000Users * 10000 / locations[location]);

            // GitHub search API is inclusive for the start date and the end date.
            const signupIntervalStartDates = daysInPeriod(signupStartDate, signupEndDate, searchPeriodInDays);

            for (const signupIntervalStartDate of signupIntervalStartDates) {
                let signupIntervalEndDate = addDays(signupIntervalStartDate, searchPeriodInDays - 1);
                if (isAfter(signupIntervalEndDate, signupEndDate)) {
                    signupIntervalEndDate = signupEndDate;
                }

                const signedUpAfter = formatDate(signupIntervalStartDate);
                const signedUpBefore = formatDate(signupIntervalEndDate);

                // create tasks for each contribSearch range
                for (const contribSearchRange of contribSearchRanges) {
                    const contribFromDate = formatDate(contribSearchRange.start);
                    const contribToDate = formatDate(contribSearchRange.end);

                    const key = uuidv4();
                    newTaskSpecs.push({
                        id: key,
                        parentId: null,
                        originatingTaskId: null,
                        //
                        location: location,
                        signedUpAfter: signedUpAfter,
                        signedUpBefore: signedUpBefore,
                        //
                        minRepositories: this.config.minRepositories,
                        minFollowers: this.config.minFollowers,
                        //
                        contribFromDate: contribFromDate,
                        contribToDate: contribToDate,
                        //
                        pageSize: this.config.pageSize,
                        startCursor: null,
                    });
                }
            }
        }

        return newTaskSpecs;
    }
}

export class UserAndContribSearchTask extends Task<UserAndContribSearchTaskResult, UserAndContribSearchTaskSpec> {

    constructor(spec:UserAndContribSearchTaskSpec) {
        super(spec);
    }

    protected getGraphqlQuery():string {
        return QUERY;
    }

    protected buildQueryParameters(_:TaskContext) {
        const searchString =
            `location:${this.spec.location} ` +
            `followers:>=${this.spec.minFollowers} ` +
            `repos:>=${this.spec.minRepositories} ` +
            // both ends are inclusive
            `created:${this.spec.signedUpAfter}..${this.spec.signedUpBefore}`;
        return {
            "searchString": searchString,
            "first": this.spec.pageSize,
            "after": this.spec.startCursor,
            // GitHub wants this field in https://en.wikipedia.org/wiki/ISO_8601 format
            // needs to be in format: YYYY-MM-DDTHH:MM:SSZ      (2023-04-01T00:00:00.000Z)
            // or                   : YYYY-MM-DDTHH:MM:SS+TZ:TZ (2023-04-01T00:00:00+03:00)
            "contribFrom": formatISOTimeStampIgnoreTimezone(startOfDay(parseDate(this.spec.contribFromDate))),
            "contribTo": formatISOTimeStampIgnoreTimezone(endOfDay(parseDate(this.spec.contribToDate))),
        };
    }

    nextTask(context:TaskContext, result:UserAndContribSearchTaskResult):UserAndContribSearchTask | null {
        // return a new task if there is a next page
        if (result.search.pageInfo.hasNextPage) {
            context.logger.debug(`Next page available for task: ${this.getId(context)}`);
            return new UserAndContribSearchTask({
                    id: uuidv4(),
                    parentId: null,
                    originatingTaskId: this.getId(context),
                    //
                    location: this.spec.location,
                    signedUpAfter: this.spec.signedUpAfter,
                    signedUpBefore: this.spec.signedUpBefore,
                    minRepositories: this.spec.minRepositories,
                    minFollowers: this.spec.minFollowers,
                    contribFromDate: this.spec.contribFromDate,
                    contribToDate: this.spec.contribToDate,
                    pageSize: this.spec.pageSize,
                    //
                    startCursor: <string>result.search.pageInfo.endCursor,
                }
            );
        }

        return null;
    }

    narrowedDownTasks(context:TaskContext):UserAndContribSearchTask[] | null {
        const logger = context.logger;

        // User search can't narrow down the scopes of the tasks that start from a cursor.
        // That's because:
        // - The cursor is bound to the date range previously used.
        // In that case, add narrowed down tasks for the originating task. That's the task that caused the creation of
        // this task with a start cursor.
        // However, this means, some date ranges will be searched twice and there will be duplicate output.
        // It is fine though! We can filter the output later.
        if (this.spec.startCursor) {
            logger.debug(`'Regular' narrowed down tasks can't be created for task ${this.getId(context)} as it has a start cursor.`);
            logger.debug(`Creating narrowed down tasks for the originating task ${this.spec.originatingTaskId}`);
        }

        const newTasks:UserAndContribSearchTask[] = [];

        // split the user signup date period into half periods
        // also split the contribution date period into half periods
        // so, we would ideally end up in 4 new tasks
        const signupStartDate = parseDate(this.spec.signedUpAfter);
        const signupEndDate = parseDate(this.spec.signedUpBefore);
        //
        const contribStartDate = parseDate(this.spec.contribFromDate);
        const contribEndDate = parseDate(this.spec.contribToDate);

        const signupHalfPeriods = splitPeriodIntoHalves(signupStartDate, signupEndDate);
        const contribHalfPeriods = splitPeriodIntoHalves(contribStartDate, contribEndDate);

        if (signupHalfPeriods.length * contribHalfPeriods.length <= 1) {
            logger.debug(`Date range based narrowed down tasks can't be created for task ${this.getId(context)}. as it can't be split into half periods anymore.`);

            if (this.spec.pageSize < 2) {
                logger.debug(`Narrowed down tasks can't be created for task ${this.getId(context)} as it has a page size less than 2.`);
                return null;
            }

            logger.debug(`Creating page size based narrowed down tasks for the task ${this.getId(context)}`);

            return [
                new UserAndContribSearchTask({
                        id: uuidv4(),
                        parentId: this.getId(context),
                        originatingTaskId: this.spec.originatingTaskId,
                        //
                        location: this.spec.location,
                        minRepositories: this.spec.minRepositories,
                        minFollowers: this.spec.minFollowers,
                        //
                        signedUpAfter: this.spec.signedUpAfter,
                        signedUpBefore: this.spec.signedUpBefore,
                        //
                        contribFromDate: this.spec.contribFromDate,
                        contribToDate: this.spec.contribToDate,
                        //
                        pageSize: Math.floor(this.spec.pageSize / 2),
                        //
                        startCursor: null,
                    }
                )
            ];
        } else {
            for (const signupHalfPeriod of signupHalfPeriods) {
                for (const contribHalfPeriod of contribHalfPeriods) {
                    newTasks.push(
                        new UserAndContribSearchTask({
                                id: uuidv4(),
                                parentId: this.getId(context),
                                originatingTaskId: this.spec.originatingTaskId,
                                //
                                location: this.spec.location,
                                minRepositories: this.spec.minRepositories,
                                minFollowers: this.spec.minFollowers,
                                //
                                signedUpAfter: formatDate(signupHalfPeriod.start),
                                signedUpBefore: formatDate(signupHalfPeriod.end),
                                //
                                contribFromDate: formatDate(contribHalfPeriod.start),
                                contribToDate: formatDate(contribHalfPeriod.end),
                                //
                                pageSize: this.spec.pageSize,
                                //
                                startCursor: null,
                            }
                        )
                    );
                }
            }
        }

        return newTasks;
    }

    saveOutput(context:TaskContext, output:UserAndContribSearchTaskResult):void {
        // TODO: when issueContributionsByRepository, issueContributionsByRepository, pullRequestContributionsByRepository, etc.
        // TODO: has 100 results (max returned by GH API), create narrowed down tasks.
        // TODO: task queue doesn't support such thing yet...

        const logger = context.logger;

        logger.debug(`Saving output of the task: ${this.getId(context)}`);

        let nodes = output.search.nodes;

        if (!nodes || nodes.length == 0) {
            logger.debug(`No nodes found for ${this.getId(context)}.`);
            nodes = [];
        }

        logger.debug(`Number of nodes found for ${this.getId(context)}: ${nodes.length}`);

        for (let i = 0; i < nodes.length; i++) {
            const fragment = <UserAndContribSearchResultFragment>nodes[i];
            // TODO: clip the email address
            // fragment.email
            // items in the array might be null, in case of partial responses
            if (fragment) {
                context.currentRunOutput.push({
                    taskId: this.getId(context),
                    result: fragment,
                });
            }
        }
    }

}

export const QUERY = `
query UserAndContribSearch($searchString: String!, $first: Int!, $after:String, $contribFrom: DateTime!, $contribTo: DateTime!){
    rateLimit {
        cost
        limit
        nodeCount
        remaining
        resetAt
        used
    }
    search(type: USER, query:$searchString, first:$first, after:$after) {
        pageInfo {
            startCursor
            hasNextPage
            endCursor
        }
        userCount
        nodes {
            ... on User {
                ...UserAndContribSearchResult
            }
        }
    }
}
fragment UserAndContribSearchResult on User {
    login
    company
    name
    createdAt
    email
    followers {
        totalCount
    }
    gists {
        totalCount
    }
    issueComments {
        totalCount
    }
    issues {
        totalCount
    }
    location
    pullRequests {
        totalCount
    }
    repositories {
        totalCount
    }
    repositoriesContributedTo {
        totalCount
    }
    repositoryDiscussionComments {
        totalCount
    }
    repositoryDiscussions {
        totalCount
    }
    socialAccounts(first: 100) {
        edges {
            node {
                ... on SocialAccount {
                    displayName
                    provider
                    url
                }
            }
        }
    }
    sponsoring {
        totalCount
    }
    sponsors {
        totalCount
    }
    twitterUsername
    websiteUrl
    contributionsCollection(from: $contribFrom, to: $contribTo) {
        startedAt
        endedAt
        totalIssueContributions
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalRepositoriesWithContributedIssues
        totalRepositoriesWithContributedCommits
        totalRepositoriesWithContributedPullRequests
        totalRepositoriesWithContributedPullRequestReviews
        issueContributionsByRepository(maxRepositories: 100) {
            contributions{
                totalCount
            }
            repository {
                ...UserSearchRepositoryId
            }
        }
        commitContributionsByRepository(maxRepositories: 100) {
            contributions{
                totalCount
            }
            repository {
                ...UserSearchRepositoryId
            }
        }
        pullRequestContributionsByRepository(maxRepositories: 100) {
            contributions{
                totalCount
            }
            repository {
                ...UserSearchRepositoryId
            }
        }
        pullRequestReviewContributionsByRepository(maxRepositories: 100) {
            contributions{
                totalCount
            }
            repository {
                ...UserSearchRepositoryId
            }
        }
    }
}
fragment UserSearchRepositoryId on Repository {
    nameWithOwner
    isInOrganization
    owner {
        login
    }
}
`;
