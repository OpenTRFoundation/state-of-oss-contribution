import assert from "assert";
import {graphql} from "@octokit/graphql";

import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {addErroredToUnresolved, initializeQueue, startTaskQueue} from "@opentr/cuttlecat/dist/subcommand/execute.js";
import {ResolvedTask, TaskQueue, TaskStore} from "@opentr/cuttlecat/dist/queue/taskqueue.js";
import nock from "nock";
import fetch from "node-fetch";

import {initializeNockBack} from "../test/initializeNockBack.js";

import FocusOrganizationDetailsCommand, {
    FocusOrganizationDetailsTaskResult,
    FocusOrganizationDetailsTaskSpec
} from "./focusOrganizationDetails.js";

// disable logging for tests
log.setLevel("error");

const logger = log.createLogger("test");

// disable logging for tests
log.setLevel("error");

initializeNockBack();

const task_org1:FocusOrganizationDetailsTaskSpec = {
    id: "task_org1",
    parentId: null,
    originatingTaskId: null,
    orgName: "org1",
    pageSize: 100,
    startCursor: null,
};

const task_org2:FocusOrganizationDetailsTaskSpec = {
    id: "task_org2",
    parentId: null,
    originatingTaskId: null,
    orgName: "org2",
    pageSize: 100,
    startCursor: null,
};

const task_org2_pageSize1:FocusOrganizationDetailsTaskSpec = {
    id: "task_org2",
    parentId: null,
    originatingTaskId: null,
    orgName: "org2",
    pageSize: 1,
    startCursor: null,
};

const task_org2_pageSize2:FocusOrganizationDetailsTaskSpec = {
    id: "task_org2",
    parentId: null,
    originatingTaskId: null,
    orgName: "org2",
    pageSize: 2,
    startCursor: null,
};

// const task_2023_01_02_two_days:FocusOrganizationDetailsTaskSpec = {
//     id: "task_2023_01_02_two_days",
//     parentId: null,
//     originatingTaskId: null,
//     minStars: 50,
//     minForks: 50,
//     minSizeInKb: 1000,
//     hasActivityAfter: "2023-01-01",
//     createdAfter: "2023-01-02",
//     createdBefore: "2023-01-03",
//     pageSize: 100,
//     startCursor: null,
// };

interface TestMatrixItem {
    unresolved:FocusOrganizationDetailsTaskSpec[],
    fixture:string,
    expectedOutput:string[][],
    expectedUnresolvedCount:number,
    expectedResolvedCount:number,
    expectedErroredCount:number,
    expectedArchivedCount:number,
    expectedNonCriticalErrors?:(RegExp | undefined)[],
}

interface TestMatrixItem {
    unresolved:FocusOrganizationDetailsTaskSpec[],
    fixture:string,
    expectedOutput:string[][],
    expectedUnresolvedCount:number,
    expectedResolvedCount:number,
    expectedErroredCount:number,
    expectedArchivedCount:number,
    expectedNonCriticalErrors?:(RegExp | undefined)[],
}

const testMatrix:TestMatrixItem[] = [
    {
        // all good, 2 tasks, each return 1 repos
        unresolved: [task_org1, task_org2],
        fixture: "focusOrganizationDetails/01-all-good-no-pagination.json",
        expectedOutput: [
            ['org1/repo1'],
            ['org2/repo1'],
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // all good, 2 tasks, each return 1 repo, 1 task has next page which returns 1 repo
        unresolved: [task_org1, task_org2],
        fixture: "focusOrganizationDetails/02-all-good-with-pagination.json",
        expectedOutput: [
            ['org1/repo1'],
            ['org2/repo1'],
            ['org2/repo2'],
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 3,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 repo, and has a next page
        // task 2 returns 1 repo, and aborts due to primary rate limit
        // next page of task 1 is not processed and stored in unresolved
        unresolved: [task_org1, task_org2],
        fixture: "focusOrganizationDetails/03-rate-limit-reached.json",
        expectedOutput: [
            ['org1/repo1'],
            ['org2/repo1'],
        ],
        expectedUnresolvedCount: 1,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 repo, and doesn't have a next page
        // task 2 errors for 4 times (1 initial try + 3 retries)
        unresolved: [task_org1, task_org2_pageSize1],
        fixture: "focusOrganizationDetails/05-unknown-error-without-narrower-scope.json",
        expectedOutput: [
            ['org1/repo1'],
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 1,
        expectedErroredCount: 1,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 repo, and doesn't have a next page
        // task 2 errors for 4 times (1 initial try + 3 retries)
        // 1 narrower scope task is created for task 2
        // task 2 is archived
        unresolved: [task_org1, task_org2_pageSize2],
        fixture: "focusOrganizationDetails/06-unknown-error-with-narrower-scopes.json",
        expectedOutput: [
            ['org1/repo1'],
            ['org2/repo1'],
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 1,
    },
];

describe('focusOrganizationDetails mock test', async () => {
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

            const unresolved:{ [key:string]:FocusOrganizationDetailsTaskSpec } = {};
            for (let i = 0; i < test.unresolved.length; i++) {
                unresolved[test.unresolved[i].id] = test.unresolved[i];
            }

            const resolved:{ [key:string]:ResolvedTask<FocusOrganizationDetailsTaskSpec> } = {};
            const errored = {};
            const archived = {};

            const taskStore:TaskStore<FocusOrganizationDetailsTaskSpec> = {
                unresolved: unresolved,
                resolved: resolved,
                errored: errored,
                archived: archived,
            };

            const context = new TaskContext(graphqlFn, 10, logger, []);

            const taskQueue = new TaskQueue<FocusOrganizationDetailsTaskResult, FocusOrganizationDetailsTaskSpec, TaskContext>(
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

            const command = new FocusOrganizationDetailsCommand();

            addErroredToUnresolved(logger, errored, unresolved, options.retryCount);
            initializeQueue(taskQueue, unresolved, context, command);

            const nockBackResult = await nock.back(test.fixture);
            const nockDone = nockBackResult.nockDone;
            const nockContext = nockBackResult.context;

            await startTaskQueue(logger, taskQueue);

            nockDone();
            nockContext.assertScopesFinished();

            const outputRepoNames = context.currentRunOutput.map((item) => {
                const result = [];
                for(const repo of item.result.repositories.nodes) {
                    if (repo === null) {
                        continue;
                    }

                    result.push(`${repo.nameWithOwner}`);
                }
                return result;
            });

            assert.deepEqual(outputRepoNames, test.expectedOutput);

            assert.equal(Object.keys(unresolved).length, test.expectedUnresolvedCount, "Unresolved count doesn't match");
            assert.equal(Object.keys(resolved).length, test.expectedResolvedCount, "Resolved count doesn't match");
            assert.equal(Object.keys(errored).length, test.expectedErroredCount, "Errored count doesn't match");
            assert.equal(Object.keys(archived).length, test.expectedArchivedCount, "Archived count doesn't match");

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
