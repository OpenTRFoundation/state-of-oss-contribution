import assert from "assert";
import {graphql} from "@octokit/graphql";

import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {addErroredToUnresolved, initializeQueue, startTaskQueue} from "@opentr/cuttlecat/dist/main.js";
import {ResolvedTask, TaskQueue, TaskStore} from "@opentr/cuttlecat/dist/queue/taskqueue.js";
import nock from "nock";
import fetch from "node-fetch";

import {initializeNockBack} from "../test/initializeNockBack.js";
import UserAndContribSearchCommand, {
    UserAndContribSearchTaskResult,
    UserAndContribSearchTaskSpec
} from "./userAndContribSearch.js";

// disable logging for tests
log.setLevel("error");

const logger = log.createLogger("test");

// disable logging for tests
log.setLevel("error");

initializeNockBack();

const task_2023_01_01_single_day_signup_interval_single_day_contrib_interval:UserAndContribSearchTaskSpec = {
    id: "task_2023_01_01_single_day_signup_interval_single_day_contrib_interval",
    parentId: null,
    originatingTaskId: null,
    //
    location: "Foo",
    minRepositories: 50,
    minFollowers: 100,
    //
    signedUpAfter: "2023-01-01",
    signedUpBefore: "2023-01-01",
    contribFromDate: "2023-01-02",
    contribToDate: "2023-01-02",
    //
    pageSize: 100,
    startCursor: null,
};

const task_2023_01_02_single_day_signup_interval_single_day_contrib_interval:UserAndContribSearchTaskSpec = {
    id: "task_2023_01_02_single_day_signup_interval_single_day_contrib_interval",
    parentId: null,
    originatingTaskId: null,
    //
    location: "Foo",
    minRepositories: 50,
    minFollowers: 100,
    //
    signedUpAfter: "2023-01-02",
    signedUpBefore: "2023-01-02",
    contribFromDate: "2023-01-03",
    contribToDate: "2023-01-03",
    //
    pageSize: 100,
    startCursor: null,
};

const task_2023_01_02_single_day_signup_interval_single_day_contrib_interval_page_size_1:UserAndContribSearchTaskSpec = {
    id: "task_2023_01_02_single_day_signup_interval_single_day_contrib_interval_page_size_1",
    parentId: null,
    originatingTaskId: null,
    //
    location: "Foo",
    minRepositories: 50,
    minFollowers: 100,
    //
    signedUpAfter: "2023-01-02",
    signedUpBefore: "2023-01-02",
    contribFromDate: "2023-01-03",
    contribToDate: "2023-01-03",
    //
    pageSize: 1,
    startCursor: null,
};

const task_2023_01_02_two_day_signup_interval_two_day_contrib_interval:UserAndContribSearchTaskSpec = {
    id: "task_2023_01_02_two_day_signup_interval_two_day_contrib_interval",
    parentId: null,
    originatingTaskId: null,
    //
    location: "Foo",
    minRepositories: 50,
    minFollowers: 100,
    //
    signedUpAfter: "2023-01-02",
    signedUpBefore: "2023-01-03",
    contribFromDate: "2023-01-04",
    contribToDate: "2023-01-05",
    //
    pageSize: 100,
    startCursor: null,
};

type TestOutput = { [key:string]:{ [key:string]:number } };

interface TestMatrixItem {
    unresolved:UserAndContribSearchTaskSpec[],
    fixture:string,
    // map<username:map<repoName:commitCount>> --> only check commit counts
    expectedOutput:TestOutput,
    expectedUnresolvedCount:number,
    expectedResolvedCount:number,
    expectedErroredCount:number,
    expectedArchivedCount:number,
    expectedNonCriticalErrors?:(RegExp | undefined)[],
}

const testMatrix:TestMatrixItem[] = [
    {
        // all good, 2 tasks, each return 1 user with their contributions
        unresolved: [task_2023_01_01_single_day_signup_interval_single_day_contrib_interval, task_2023_01_02_single_day_signup_interval_single_day_contrib_interval],
        fixture: "userAndContribSearch/01-all-good-no-pagination.json",
        expectedOutput: {
            "user_1": {"org/repo_1": 1, "org/repo_2": 2},
            "user_2": {"org/repo_1": 3, "org/repo_3": 4},
        },
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // all good, 2 tasks, each return 1 user with their contributions, 1 task has next page which returns 1 user
        unresolved: [task_2023_01_01_single_day_signup_interval_single_day_contrib_interval, task_2023_01_02_single_day_signup_interval_single_day_contrib_interval],
        fixture: "userAndContribSearch/02-all-good-with-pagination.json",
        expectedOutput: {
            "user_1": {"org/repo_1": 1, "org/repo_2": 2},
            "user_2": {"org/repo_1": 3, "org/repo_3": 4},
            "user_3": {"org/repo_1": 5, "org/repo_3": 6},
        },
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 3,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 user and contrib, and has a next page
        // task 2 returns 1 repo and contrib, and aborts due to primary rate limit
        // next page of task 1 is not processed and stored in unresolved
        unresolved: [task_2023_01_01_single_day_signup_interval_single_day_contrib_interval, task_2023_01_02_single_day_signup_interval_single_day_contrib_interval],
        fixture: "userAndContribSearch/03-rate-limit-reached.json",
        expectedOutput: {
            "user_1": {"org/repo_1": 1, "org/repo_2": 2},
            "user_2": {"org/repo_1": 3, "org/repo_3": 4},
        },
        expectedUnresolvedCount: 1,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 user, and doesn't have a next page
        // task 2 errors for 3 times and then returns 1 user
        unresolved: [task_2023_01_01_single_day_signup_interval_single_day_contrib_interval, task_2023_01_02_single_day_signup_interval_single_day_contrib_interval],
        fixture: "userAndContribSearch/04-retry-works.json",
        expectedOutput: {
            "user_1": {"org/repo_1": 1, "org/repo_2": 2},
            "user_2": {"org/repo_1": 3, "org/repo_3": 4},
        },
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 user, and doesn't have a next page
        // task 2 errors for 4 times (1 initial try + 3 retries) and can't be narrowed down
        unresolved: [task_2023_01_01_single_day_signup_interval_single_day_contrib_interval, task_2023_01_02_single_day_signup_interval_single_day_contrib_interval_page_size_1],
        fixture: "userAndContribSearch/05-unknown-error-without-narrower-scope.json",
        expectedOutput: {
            "user_1": {"org/repo_1": 1, "org/repo_2": 2},
        },
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 1,
        expectedErroredCount: 1,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 user, and doesn't have a next page
        // task 2 errors for 4 times (1 initial try + 3 retries)
        // 4 tasks with narrower scope tasks are created for task 2
        // task 2 is archived
        unresolved: [task_2023_01_01_single_day_signup_interval_single_day_contrib_interval, task_2023_01_02_two_day_signup_interval_two_day_contrib_interval],
        fixture: "userAndContribSearch/06-unknown-error-with-narrower-scopes.json",
        expectedOutput: {
            "user_1": {"org/repo_1": 1, "org/repo_2": 2},
            "user_2_1": {"org/repo_2_1_1": 1, "org/repo_2_1_2": 2},
            "user_2_2": {"org/repo_2_2_1": 1, "org/repo_2_2_2": 2},
            "user_2_3": {"org/repo_2_3_1": 1, "org/repo_2_3_2": 2},
            "user_2_4": {"org/repo_2_4_1": 1, "org/repo_2_4_2": 2},
        },
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 5,
        expectedErroredCount: 0,
        expectedArchivedCount: 1,
    },
    {
        // task 1 returns 1 user, and has a next page
        // task 2 hits secondary rate limit and won't return any results. it will abort the queue
        // next page of task 1 is not processed and stored in unresolved
        unresolved: [task_2023_01_01_single_day_signup_interval_single_day_contrib_interval, task_2023_01_02_single_day_signup_interval_single_day_contrib_interval],
        fixture: "userAndContribSearch/07-secondary-rate-limit-reached.json",
        expectedOutput: {
            "user_1": {"org/repo_1": 1, "org/repo_2": 2}
        },
        expectedUnresolvedCount: 2,
        expectedResolvedCount: 1,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 user
        // task 2 returns 2 users, but one contribution is null, due to IP limitations
        unresolved: [task_2023_01_01_single_day_signup_interval_single_day_contrib_interval, task_2023_01_02_single_day_signup_interval_single_day_contrib_interval],
        fixture: "userAndContribSearch/08-partial-response.json",
        expectedOutput: {
            "user_1": {"org/repo_1": 1, "org/repo_2": 2},
            "user_2": {"org/repo_1": 3},
        },
        expectedNonCriticalErrors: [
            undefined,
            /Although you appear to have the correct authorization credentials/,
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
];

describe('userAndContribSearch mock test', async () => {
    testMatrix.forEach((test) => {
        it(test.fixture, async () => {
            const signal = new AbortController().signal;

            const graphqlFn = graphql.defaults({
                headers: {
                    "authorization": `bearer 000000000000000000000000000`,
                    // nock doesn't really support gzip, so we need to disable it
                    "accept-encoding": 'identity'
                },
                request: {
                    signal: signal,
                    fetch: fetch,
                }
            });

            const unresolved:{ [key:string]:UserAndContribSearchTaskSpec } = {};
            for (let i = 0; i < test.unresolved.length; i++) {
                unresolved[test.unresolved[i].id] = test.unresolved[i];
            }

            const resolved:{ [key:string]:ResolvedTask<UserAndContribSearchTaskSpec> } = {};
            const errored = {};
            const archived = {};

            const taskStore:TaskStore<UserAndContribSearchTaskSpec> = {
                unresolved: unresolved,
                resolved: resolved,
                errored: errored,
                archived: archived,
            };

            const context = new TaskContext(graphqlFn, 10, logger, []);

            const taskQueue = new TaskQueue<UserAndContribSearchTaskResult, UserAndContribSearchTaskSpec, TaskContext>(
                taskStore,
                {
                    concurrency: 4,
                    perTaskTimeout: 30000,
                    intervalCap: 10,
                    interval: 10000,
                    retryCount: 3,
                }, context);

            const options = {
                retryCount: 3,
                rateLimitStopPercent: 10,
            };

            const command = new UserAndContribSearchCommand();

            addErroredToUnresolved(logger, errored, unresolved, options.retryCount);
            initializeQueue(taskQueue, unresolved, context, command);

            const nockBackResult = await nock.back(test.fixture);
            const nockDone = nockBackResult.nockDone;
            const nockContext = nockBackResult.context;

            await startTaskQueue(logger, taskQueue);

            nockDone();
            nockContext.assertScopesFinished();

            const retrievedOutput:TestOutput = {};
            context.currentRunOutput.forEach((item) => {
                const userName = item.result.login;
                for (const commitContrib of item.result.contributionsCollection.commitContributionsByRepository) {
                    const repoName = commitContrib.repository?.nameWithOwner;
                    if (!repoName) {
                        continue;
                    }
                    const commitCount = commitContrib.contributions.totalCount;
                    if (!retrievedOutput[userName]) {
                        retrievedOutput[userName] = {};
                    }
                    retrievedOutput[userName][repoName] = commitCount;
                }
            });

            assert.deepEqual(retrievedOutput, test.expectedOutput);

            assert.equal(Object.keys(unresolved).length, test.expectedUnresolvedCount);
            assert.equal(Object.keys(resolved).length, test.expectedResolvedCount);
            assert.equal(Object.keys(errored).length, test.expectedErroredCount);
            assert.equal(Object.keys(archived).length, test.expectedArchivedCount);

            if (test.expectedNonCriticalErrors) {
                // collect non-critical errors
                const nonCriticalErrors = Object.values(resolved).map((item) => {
                    return item.nonCriticalError?.message;
                });

                assert.equal(nonCriticalErrors.length, test.expectedNonCriticalErrors.length);

                for (let i = 0; i < nonCriticalErrors.length; i++) {
                    if (nonCriticalErrors[i] === undefined) {
                        assert.strictEqual(nonCriticalErrors[i], test.expectedNonCriticalErrors[i]);
                    } else {
                        assert.match(<string>nonCriticalErrors[i], <RegExp>test.expectedNonCriticalErrors[i]);
                    }
                }
            }
        });
    });
});
