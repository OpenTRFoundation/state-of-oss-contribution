import assert from "assert";
import {graphql} from "@octokit/graphql";

import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {addErroredToUnresolved, initializeQueue, startTaskQueue} from "@opentr/cuttlecat/dist/subcommand/execute.js";
import {TaskQueue, TaskStore} from "@opentr/cuttlecat/dist/queue/taskqueue.js";
import nock from "nock";
import fetch from "node-fetch";

import {initializeNockBack} from "../test/initializeNockBack.js";
import UserCountSearchCommand, {UserCountSearchTaskResult, UserCountSearchTaskSpec} from "./userCountSearch.js";

// disable logging for tests
log.setLevel("error");

const logger = log.createLogger("test");

// disable logging for tests
log.setLevel("error");

initializeNockBack();

const task_turkey:UserCountSearchTaskSpec = {
    id: "task_turkey",
    parentId: null,
    originatingTaskId: null,
    minRepositories: 50,
    minFollowers: 50,
    location: "Turkey",
};

const task_adana:UserCountSearchTaskSpec = {
    id: "task_adana",
    parentId: null,
    originatingTaskId: null,
    minRepositories: 50,
    minFollowers: 50,
    location: "Adana",
};

const task_foo:UserCountSearchTaskSpec = {
    id: "task_foo",
    parentId: null,
    originatingTaskId: null,
    minRepositories: 50,
    minFollowers: 50,
    location: "Foo",
};

interface TestMatrixItem {
    unresolved:UserCountSearchTaskSpec[],
    fixture:string,
    expectedOutput:{ [key:string]:number }[],
    expectedUnresolvedCount:number,
    expectedResolvedCount:number,
    expectedErroredCount:number,
    expectedArchivedCount:number,
}

const testMatrix:TestMatrixItem[] = [
    {
        // all good, 2 tasks
        unresolved: [task_turkey, task_adana],
        fixture: "userCountSearch/01-all-good.json",
        expectedOutput: [
            {"Turkey": 100},
            {"Adana": 1},
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // 2 tasks, 1st aborts due to primary rate limit
        unresolved: [task_turkey, task_adana],
        fixture: "userCountSearch/02-rate-limit-reached.json",
        expectedOutput: [
            {"Turkey": 100},
        ],
        expectedUnresolvedCount: 1,
        expectedResolvedCount: 1,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // 2 tasks, 2nd errors for 3 times and then succeeds
        unresolved: [task_turkey, task_adana],
        fixture: "userCountSearch/03-retry-works.json",
        expectedOutput: [
            {"Turkey": 100},
            {"Adana": 1},
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // 2 tasks, 2nd errors for 4 times (1 initial try + 3 retries)
        unresolved: [task_turkey, task_adana],
        fixture: "userCountSearch/04-unknown-error.json",
        expectedOutput: [
            {"Turkey": 100},
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 1,
        expectedErroredCount: 1,
        expectedArchivedCount: 0,
    },
    {
        // 3 tasks, 2nd aborts due to secondary rate limit, it will abort the queue
        unresolved: [task_turkey, task_foo, task_adana],
        fixture: "userCountSearch/05-secondary-rate-limit-reached.json",
        expectedOutput: [
            {"Turkey": 100},
        ],
        expectedUnresolvedCount: 2,
        expectedResolvedCount: 1,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
];

describe('userCountSearch mock test', () => {
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

            const unresolved:{ [key:string]:UserCountSearchTaskSpec } = {};
            for (let i = 0; i < test.unresolved.length; i++) {
                unresolved[test.unresolved[i].id] = test.unresolved[i];
            }

            const resolved = {};
            const errored = {};
            const archived = {};

            const taskStore:TaskStore<UserCountSearchTaskSpec> = {
                unresolved: unresolved,
                resolved: resolved,
                errored: errored,
                archived: archived,
            };

            const context = new TaskContext(graphqlFn, 10, logger, []);

            const taskQueue = new TaskQueue<UserCountSearchTaskResult, UserCountSearchTaskSpec, TaskContext>(
                taskStore,
                {
                    concurrency: 4,
                    perTaskTimeout: 30000,
                    intervalCap: 100000,
                    interval: 0,
                    retryCount: 3,
                }, context);

            const options = {
                retryCount: 3,
                rateLimitStopPercent: 10,
            };

            const command = new UserCountSearchCommand();

            addErroredToUnresolved(logger, errored, unresolved, options.retryCount);
            initializeQueue(taskQueue, unresolved, context, command);

            const nockBackResult = await nock.back(test.fixture);
            const nockDone = nockBackResult.nockDone;
            const nockContext = nockBackResult.context;

            await startTaskQueue(logger, taskQueue);

            nockDone();
            nockContext.assertScopesFinished();

            // assertions
            assert.equal(context.currentRunOutput.length, test.expectedOutput.length);

            const outputRepoNames = context.currentRunOutput.map((item) => {
                const location = item.result.location;
                const ret:any = {};
                ret[location] = item.result.userCount
                return ret;
            });

            assert.deepEqual(outputRepoNames, test.expectedOutput);
        });
    });
});
