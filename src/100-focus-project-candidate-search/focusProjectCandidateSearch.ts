import {Command} from "@opentr/cuttlecat/dist/graphql/command.js";
import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import {Task} from "@opentr/cuttlecat/dist/graphql/task.js";
import {TaskResult} from "@opentr/cuttlecat/dist/graphql/taskResult.js";
import {TaskSpec} from "@opentr/cuttlecat/dist/graphql/taskSpec.js";

import {
    addDays,
    daysInPeriod,
    formatDate,
    parseDate,
    splitPeriodIntoHalves,
    subtractDays
} from "@opentr/cuttlecat/dist/utils.js";

import {isAfter} from "date-fns";
import {v4 as uuidv4} from "uuid";

/**
 * This example task searches for repositories that can be used to identify focus organizations and projects.
 *
 * Criteria:
 * - is public
 * - is not a template
 * - is not archived
 * - has at least MIN_STARS stars, MIN_FORKS forks, MIN_SIZE_IN_KB size
 * - has an activity (push) within the last MAX_INACTIVITY_DAYS days
 * - created after EXCLUDE_REPOSITORIES_CREATED_BEFORE
 * - created before (now - MIN_AGE_IN_DAYS)
 *
 * Examples:
 * - minStars=50 minForks=50 minSizeInKb=1000 maxInactivityDays=90
 *   Find repositories that have at least 50 stars, 50 forks, 1000KB size, had an activity in the past 90 days.
 *
 * - excludeRepositoriesCreatedBefore=2008-01-01, minAgeInDays=365
 *   Exclude repositories created before 2008-01-01 and that are created within last year.
 *
 * - searchPeriodInDays=5, pageSize=100
 *   Search for repositories in 5 day-periods within the date range and ask for 100 repositories in one call (change these to avoid GitHub API timeouts).
 */

export interface FocusProjectCandidateSearchConfig {
    // ------ CRITERIA - described above --------
    excludeRepositoriesCreatedBefore:string;
    minAgeInDays:number;
    maxInactivityDays:number;
    minStars:number;
    minForks:number;
    minSizeInKb:number;

    // ------ SEARCH tuning --------
    // The search period is used to split the given date range into smaller periods.
    // This is done to avoid timeouts from the GitHub API. If the search period is too large, the API will timeout.
    searchPeriodInDays:number;
    // The page size is the maximum number of repositories to fetch in one call.
    pageSize:number;
}

const DEFAULT_CONFIG:FocusProjectCandidateSearchConfig = {
    // ------ CRITERIA - described above --------
    excludeRepositoriesCreatedBefore: "2008-01-01",
    minAgeInDays: 365,
    maxInactivityDays: 90,
    minStars: 50,
    minForks: 50,
    minSizeInKb: 1000,

    // ------ SEARCH tuning --------
    searchPeriodInDays: 5,
    pageSize: 100,
};

export interface RepositorySummaryFragment {
    nameWithOwner:string;
    isInOrganization:boolean;
    owner:{
        login:string;
    };
    forkCount:number;
    stargazerCount:number;
    pullRequests:{
        totalCount:number;
    };
    issues:{
        totalCount:number;
    };
    mentionableUsers:{
        totalCount:number;
    };
    watchers:{
        totalCount:number;
    };
}

export interface FocusProjectCandidateSearchTaskResult extends TaskResult {
    search:{
        pageInfo:{
            startCursor:string | null;
            hasNextPage:boolean;
            endCursor:string | null;
        };
        repositoryCount:number | null;
        nodes:RepositorySummaryFragment[] | null;
    };
}

export interface FocusProjectCandidateSearchTaskSpec extends TaskSpec {
    minStars:number;
    minForks:number;
    minSizeInKb:number;
    hasActivityAfter:string;
    createdAfter:string;
    createdBefore:string;
    pageSize:number;
    startCursor:string | null;
}

export default class FocusProjectCandidateSearchCommand implements Command<FocusProjectCandidateSearchTaskResult, FocusProjectCandidateSearchTaskSpec, FocusProjectCandidateSearchTask> {
    private readonly config:FocusProjectCandidateSearchConfig;
    private readonly nowFn:() => Date;

    constructor(config?:FocusProjectCandidateSearchConfig, nowFn?:() => Date) {
        this.config = config ?? DEFAULT_CONFIG;
        this.nowFn = nowFn ?? (() => new Date());
    }

    createTask(_:TaskContext, spec:FocusProjectCandidateSearchTaskSpec):FocusProjectCandidateSearchTask {
        return new FocusProjectCandidateSearchTask(spec);
    }

    createNewQueueItems(context:TaskContext):FocusProjectCandidateSearchTaskSpec[] {
        const logger = context.logger;

        const startDate = parseDate(this.config.excludeRepositoriesCreatedBefore);
        const endDate = subtractDays(this.nowFn(), this.config.minAgeInDays);

        // GitHub search API is inclusive for the start date and the end date.
        //
        // Example call with a 2-day period:
        //
        // curl -G \
        //   -H "Accept: application/vnd.github+json" \
        //   -H "X-GitHub-Api-Version: 2022-11-28" \
        //   --data-urlencode 'q=stars:>50 forks:>10 is:public pushed:>2023-06-19 size:>1000 template:false archived:false created:2010-01-12..2010-01-13' \
        //   "https://api.github.com/search/repositories" | jq '.items[] | "\(.created_at)   \(.full_name)"'
        // Results:
        // "2010-01-12T09:37:53Z   futuretap/InAppSettingsKit"
        // "2010-01-13T05:52:38Z   vasi/pixz"
        //
        // Example call with a 1-day period:
        //
        // curl -G \
        //   -H "Accept: application/vnd.github+json" \
        //   -H "X-GitHub-Api-Version: 2022-11-28" \
        //   --data-urlencode 'q=stars:>50 forks:>10 is:public pushed:>2023-06-19 size:>1000 template:false archived:false created:2010-01-13..2010-01-13' \
        //   "https://api.github.com/search/repositories" | jq '.items[] | "\(.created_at)   \(.full_name)"'
        // Results:
        // "2010-01-13T05:52:38Z   vasi/pixz"
        //
        // So, to prevent any duplicates, we need to make sure that the intervals are exclusive.
        // Like these:
        // - 2023-01-01 - 2023-01-05
        // - 2023-01-06 - 2023-01-10

        const interval = daysInPeriod(startDate, endDate, this.config.searchPeriodInDays);
        const hasActivityAfter = formatDate(subtractDays(this.nowFn(), this.config.maxInactivityDays))

        logger.info(`Creating a new process state, startDate: ${formatDate(startDate)}, endDate: ${formatDate(endDate)}, hasActivityAfter: ${hasActivityAfter}`);

        const newTaskSpecs:FocusProjectCandidateSearchTaskSpec[] = [];

        // create tasks for each interval
        for (let i = 0; i < interval.length; i++) {
            const intervalStartDate = interval[i];
            let intervalEndDate = addDays(intervalStartDate, this.config.searchPeriodInDays - 1);
            if (isAfter(intervalEndDate, endDate)) {
                intervalEndDate = endDate;
            }

            const createdAfter = formatDate(intervalStartDate);
            const createdBefore = formatDate(intervalEndDate);
            const key = uuidv4();
            newTaskSpecs.push(
                {
                    id: key,
                    parentId: null,
                    originatingTaskId: null,
                    minStars: this.config.minStars,
                    minForks: this.config.minForks,
                    minSizeInKb: this.config.minSizeInKb,
                    hasActivityAfter: hasActivityAfter,
                    createdAfter: createdAfter,
                    createdBefore: createdBefore,
                    pageSize: this.config.pageSize,
                    startCursor: null,
                }
            );
        }

        return newTaskSpecs;
    }
}

export class FocusProjectCandidateSearchTask extends Task<FocusProjectCandidateSearchTaskResult, FocusProjectCandidateSearchTaskSpec> {

    constructor(spec:FocusProjectCandidateSearchTaskSpec) {
        super(spec);
    }

    protected getGraphqlQuery():string {
        return QUERY;
    }

    protected buildQueryParameters(_:TaskContext) {
        const searchString =
            "is:public template:false archived:false " +
            `stars:>=${this.spec.minStars} ` +
            `forks:>=${this.spec.minForks} ` +
            `size:>=${this.spec.minSizeInKb} ` +
            `pushed:>=${this.spec.hasActivityAfter} ` +
            // both ends are inclusive
            `created:${this.spec.createdAfter}..${this.spec.createdBefore}`;

        return {
            "searchString": searchString,
            "first": this.spec.pageSize,
            "after": this.spec.startCursor,
        };
    }

    nextTask(context:TaskContext, result:FocusProjectCandidateSearchTaskResult):FocusProjectCandidateSearchTask | null {
        // return a new task if there is a next page
        if (result.search.pageInfo.hasNextPage) {
            context.logger.debug(`Next page available for task: ${this.getId(context)}`);
            const newSpec:FocusProjectCandidateSearchTaskSpec = {
                id: uuidv4(),
                parentId: null,
                originatingTaskId: this.getId(context),
                //
                minStars: this.spec.minStars,
                minForks: this.spec.minForks,
                minSizeInKb: this.spec.minSizeInKb,
                hasActivityAfter: this.spec.hasActivityAfter,
                createdAfter: this.spec.createdAfter,
                createdBefore: this.spec.createdBefore,
                pageSize: this.spec.pageSize,
                //
                startCursor: <string>result.search.pageInfo.endCursor,
            };

            return new FocusProjectCandidateSearchTask(newSpec);
        }

        return null;
    }

    narrowedDownTasks(context:TaskContext):FocusProjectCandidateSearchTask[] | null {
        const logger = context.logger;

        // Project search can't narrow down the scopes of the tasks that start from a cursor.
        // That's because:
        // - The cursor is bound to the date range previously used.
        // In that case, add narrowed down tasks for the originating task. That's the task that caused the creation of
        // this task with a start cursor.
        // However, this means, some date ranges will be searched twice and there will be duplicate output.
        // It is fine though! We can filter the output later.
        if (this.spec.startCursor) {
            logger.debug(`Narrowed down tasks can't be created for task ${this.getId(context)} as it has a start cursor.`);
            logger.debug(`Creating narrowed down tasks for the originating task ${this.spec.originatingTaskId}`);
        }

        const newTasks:FocusProjectCandidateSearchTask[] = [];
        const startDate = parseDate(this.spec.createdAfter);
        const endDate = parseDate(this.spec.createdBefore);

        const halfPeriods = splitPeriodIntoHalves(startDate, endDate);
        if (halfPeriods.length <= 1) {
            logger.debug(`Narrowed down tasks can't be created for task ${this.getId(context)}. as it can't be split into half periods.`);
            return null;
        }

        for (let i = 0; i < halfPeriods.length; i++) {
            const halfPeriod = halfPeriods[i];
            const newSpec:FocusProjectCandidateSearchTaskSpec = {
                id: uuidv4(),
                parentId: this.getId(context),
                originatingTaskId: this.spec.originatingTaskId,
                //
                minStars: this.spec.minStars,
                minForks: this.spec.minForks,
                minSizeInKb: this.spec.minSizeInKb,
                hasActivityAfter: this.spec.hasActivityAfter,
                //
                createdAfter: formatDate(halfPeriod.start),
                createdBefore: formatDate(halfPeriod.end),
                //
                pageSize: this.spec.pageSize,
                //
                startCursor: null,
            };
            newTasks.push(new FocusProjectCandidateSearchTask(newSpec));
        }

        return newTasks;
    }

    saveOutput(context:TaskContext, output:FocusProjectCandidateSearchTaskResult):void {
        const logger = context.logger;

        logger.debug(`Saving output of the task: ${this.getId(context)}`);

        let nodes = output.search.nodes;

        if (!nodes || nodes.length == 0) {
            logger.debug(`No nodes found for ${this.getId(context)}.`);
            nodes = [];
        }

        logger.debug(`Number of nodes found for ${this.getId(context)}: ${nodes.length}`);

        for (let i = 0; i < nodes.length; i++) {
            const repoSummary = <RepositorySummaryFragment>nodes[i];
            // items in the array might be null, in case of partial responses
            if (repoSummary) {
                context.currentRunOutput.push({
                    taskId: this.getId(context),
                    result: repoSummary,
                });
            }
        }
    }

}

// ideally, we would want to filter open and merged PRs, but that makes the API timeout
// pullRequests(states:[OPEN, MERGED]){
export const QUERY = `
query FocusProjectCandidateSearch($searchString: String!, $first: Int!, $after:String) {
    rateLimit{
        cost
        limit
        nodeCount
        remaining
        resetAt
        used
    }
    search(type:REPOSITORY, query:$searchString, first:$first, after:$after){
        pageInfo {
            startCursor
            hasNextPage
            endCursor
        }
        repositoryCount
        nodes{
            ...RepositorySummary
        }
    }
}
fragment RepositorySummary on Repository{
    nameWithOwner
    isInOrganization
    owner{
        login
    }
    forkCount
    stargazerCount
    pullRequests{
        totalCount
    }
    issues{
        totalCount
    }
    mentionableUsers{
        totalCount
    }
    watchers{
        totalCount
    }
}
`;
