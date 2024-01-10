import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {parseDate} from "@opentr/cuttlecat/dist/utils.js";
import {expect} from "chai";
import mockfs, {restore as mockfsRestore} from "mock-fs";

import UserAndContribSearchCommand, {
    UserAndContribSearchConfig,
    UserAndContribSearchTaskSpec
} from "./userAndContribSearch.js";

// disable logging for tests
log.setLevel("error");

const logger = log.createLogger("test");
const context = new TaskContext(<any>null, 0, logger, []);

function fakeNow():Date {
    return parseDate("2023-01-31");
}

function sortItemsByDate(items:UserAndContribSearchTaskSpec[]) {
    items.sort((a, b) => {
        const signedUpBeforeDiff = a.signedUpBefore.localeCompare(b.signedUpBefore);
        if (signedUpBeforeDiff != 0) {
            return signedUpBeforeDiff;
        }
        return a.contribFromDate.localeCompare(b.contribFromDate);
    });
}

function findTasksForLocation(items:UserAndContribSearchTaskSpec[], search:string) {
    const tasks = [];
    for (const item of items) {
        if (item.location == search) {
            tasks.push(item);
        }
    }
    sortItemsByDate(tasks);
    return tasks;
}

describe('userAndContribSearch unit test', () => {
    describe('#createNewProcessState()', function () {
        this.timeout(20000);    // this might take a while
        afterEach(() => {
            mockfsRestore();
        });
        it('should create new process state, 1 day signup range, 1 day interval, 1 day contrib range, 1 contrib search period part, 1 location', function () {
            mockfs({
                '/tmp/foo/bar': {
                    '2023-01-02-00-00-00': {
                        'state.json': JSON.stringify({"completionDate": "2023-01-02-01-00-00"}),
                        'output-01.json':
                            '{"taskId": "foo1", "result": {"location": "Neptune", "userCount": 1}}' + "\n"
                    }
                }
            });

            const config:UserAndContribSearchConfig = {
                userCountPerLocationFilesDir: '/tmp/foo/bar',
                searchPeriodInDaysFor10000Users: 1,
                minRepositories: 1,
                minFollowers: 1,
                excludeUsersSignedUpBefore: "2023-01-30",
                minUserAge: 1, // 2023-01-30
                contribMaxAge: 1, // 2023-01-30
                contribMinAge: 1, // 2023-01-30
                contribSearchPeriodParts: 1,
                pageSize: 1,
            };
            const command = new UserAndContribSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            expect(items).to.have.lengthOf(1);

            const task = items[0];
            // fixed
            expect(task.id).to.be.not.null;
            expect(task.parentId).to.be.null;
            expect(task.originatingTaskId).to.be.null;
            // depends on input
            expect(task.minRepositories).to.be.equal(config.minRepositories);
            expect(task.minFollowers).to.be.equal(config.minFollowers);
            expect(task.startCursor).to.be.null;
            expect(task.pageSize).to.be.equal(config.pageSize);
            // built from input
            expect(task.location).to.be.equal("Neptune");
            expect(task.signedUpAfter).to.be.equal("2023-01-30");
            expect(task.signedUpBefore).to.be.equal("2023-01-30");
            expect(task.contribFromDate).to.be.equal("2023-01-30");
            expect(task.contribToDate).to.be.equal("2023-01-30");
        });
        it('should create new process state, 5 day signup range, 1 day contrib range, 1 contrib search period part, 4 sample locations', function () {
            mockfs({
                '/tmp/foo/bar': {
                    '2023-01-02-00-00-00': {
                        'state.json': JSON.stringify({"completionDate": "2023-01-02-01-00-00"}),
                        'output-01.json':
                            '{"taskId": "foo1", "result": {"location": "Neptune", "userCount": 1}}' + "\n" +
                            '{"taskId": "foo2", "result": {"location": "Jupiter", "userCount": 1000}}' + "\n" +
                            "",
                        'output-02.json':
                            '{"taskId": "foo3", "result": {"location": "Mercury", "userCount": 10000}}' + "\n" +
                            '{"taskId": "foo4", "result": {"location": "Galileo", "userCount": 50000}}' + "\n" +
                            ""
                    }
                }
            });

            const config:UserAndContribSearchConfig = {
                userCountPerLocationFilesDir: '/tmp/foo/bar',
                searchPeriodInDaysFor10000Users: 1,
                minRepositories: 1,
                minFollowers: 1,
                excludeUsersSignedUpBefore: "2023-01-26",  // 5 days in range
                minUserAge: 1, // 2023-01-30
                contribMaxAge: 1, // 2023-01-30
                contribMinAge: 1, // 2023-01-30
                contribSearchPeriodParts: 1,
                pageSize: 1,
            };
            const command = new UserAndContribSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            // 1 for Neptune, with the entire search date range
            // 1 for Jupiter, with the entire search date range
            // 5 for Mercury, with 5 days split into 1 day each
            // 5 for Galileo, with 5 days split into 1 day each
            expect(Object.keys(items)).to.have.lengthOf(1 + 1 + 5 + 5);


            // Neptune's task should have the entire search date range
            expect(findTasksForLocation(items, "Neptune")[0].signedUpAfter).to.be.equal("2023-01-26");
            expect(findTasksForLocation(items, "Neptune")[0].signedUpBefore).to.be.equal("2023-01-30");

            // same for Jupiter
            expect(findTasksForLocation(items, "Jupiter")[0].signedUpAfter).to.be.equal("2023-01-26");
            expect(findTasksForLocation(items, "Jupiter")[0].signedUpBefore).to.be.equal("2023-01-30");

            // Mercury's tasks should have 1 day each
            expect(findTasksForLocation(items, "Mercury")[0].signedUpAfter).to.be.equal("2023-01-26");
            expect(findTasksForLocation(items, "Mercury")[0].signedUpBefore).to.be.equal("2023-01-26");
            expect(findTasksForLocation(items, "Mercury")[1].signedUpAfter).to.be.equal("2023-01-27");
            expect(findTasksForLocation(items, "Mercury")[4].signedUpBefore).to.be.equal("2023-01-30");

            // same for Galileo
            expect(findTasksForLocation(items, "Galileo")[0].signedUpAfter).to.be.equal("2023-01-26");
            expect(findTasksForLocation(items, "Galileo")[0].signedUpBefore).to.be.equal("2023-01-26");
            expect(findTasksForLocation(items, "Galileo")[1].signedUpAfter).to.be.equal("2023-01-27");
            expect(findTasksForLocation(items, "Galileo")[4].signedUpBefore).to.be.equal("2023-01-30");
        });
        it('should create new process state, 5000 day signup range, 1 day contrib range, 1 contrib search period part, 4 sample locations', function () {
            mockfs({
                '/tmp/foo/bar': {
                    '2023-01-02-00-00-00': {
                        'state.json': JSON.stringify({"completionDate": "2023-01-02-01-00-00"}),
                        'output-01.json':
                            '{"taskId": "foo1", "result": {"location": "Neptune", "userCount": 1}}' + "\n" +
                            '{"taskId": "foo2", "result": {"location": "Jupiter", "userCount": 1000}}' + "\n" +
                            "",
                        'output-02.json':
                            '{"taskId": "foo3", "result": {"location": "Mercury", "userCount": 10000}}' + "\n" +
                            '{"taskId": "foo4", "result": {"location": "Galileo", "userCount": 50000}}' + "\n" +
                            ""
                    }
                }
            });

            const config:UserAndContribSearchConfig = {
                userCountPerLocationFilesDir: '/tmp/foo/bar',
                searchPeriodInDaysFor10000Users: 1,
                minRepositories: 1,
                minFollowers: 1,
                // today is 2023-01-31
                excludeUsersSignedUpBefore: "2008-01-11",  // 5500 days before
                minUserAge: 500, // 2021-09-19 --> 500 days before  --> 5000 day range
                contribMaxAge: 1, // 2023-01-30
                contribMinAge: 1, // 2023-01-30
                contribSearchPeriodParts: 1,
                pageSize: 1,
            };
            const command = new UserAndContribSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            // 1 for Neptune, with the entire search date range
            // 500 for Jupiter, with 5000 days split into 10 days each
            // 5000 for Mercury, with 5000 days split into 1 day each
            // 5000 for Galileo, with 5000 days split into 1 day each
            expect(Object.keys(items)).to.have.lengthOf(1 + 500 + 5000 + 5000);


            // Neptune's task should have the entire search date range
            expect(findTasksForLocation(items, "Neptune")[0].signedUpAfter).to.be.equal("2008-01-11");
            expect(findTasksForLocation(items, "Neptune")[0].signedUpBefore).to.be.equal("2021-09-18");

            // Jupiter's tasks should have a range of 10 days
            expect(findTasksForLocation(items, "Jupiter")[0].signedUpAfter).to.be.equal("2008-01-11");
            expect(findTasksForLocation(items, "Jupiter")[0].signedUpBefore).to.be.equal("2008-01-20");
            expect(findTasksForLocation(items, "Jupiter")[499].signedUpBefore).to.be.equal("2021-09-18");

            // Mercury's tasks should have 1 day each
            expect(findTasksForLocation(items, "Mercury")[0].signedUpAfter).to.be.equal("2008-01-11");
            expect(findTasksForLocation(items, "Mercury")[0].signedUpBefore).to.be.equal("2008-01-11");
            expect(findTasksForLocation(items, "Mercury")[4999].signedUpAfter).to.be.equal("2021-09-18");
            expect(findTasksForLocation(items, "Mercury")[4999].signedUpBefore).to.be.equal("2021-09-18");

            // same for Galileo
            expect(findTasksForLocation(items, "Galileo")[0].signedUpAfter).to.be.equal("2008-01-11");
            expect(findTasksForLocation(items, "Galileo")[0].signedUpBefore).to.be.equal("2008-01-11");
            expect(findTasksForLocation(items, "Galileo")[4999].signedUpAfter).to.be.equal("2021-09-18");
            expect(findTasksForLocation(items, "Galileo")[4999].signedUpBefore).to.be.equal("2021-09-18");
        });
        it('should create new process state, 5000 day signup range, 5 day periods for 10000 users per location, 1 day contrib range, 1 contrib search period part, 4 sample locations', function () {
            mockfs({
                '/tmp/foo/bar': {
                    '2023-01-02-00-00-00': {
                        'state.json': JSON.stringify({"completionDate": "2023-01-02-01-00-00"}),
                        'output-01.json':
                            '{"taskId": "foo1", "result": {"location": "Neptune", "userCount": 1}}' + "\n" +
                            '{"taskId": "foo2", "result": {"location": "Jupiter", "userCount": 1000}}' + "\n" +
                            "",
                        'output-02.json':
                            '{"taskId": "foo3", "result": {"location": "Mercury", "userCount": 10000}}' + "\n" +
                            '{"taskId": "foo4", "result": {"location": "Galileo", "userCount": 50000}}' + "\n" +
                            ""
                    }
                }
            });

            const config:UserAndContribSearchConfig = {
                userCountPerLocationFilesDir: '/tmp/foo/bar',
                searchPeriodInDaysFor10000Users: 5,
                minRepositories: 1,
                minFollowers: 1,
                // today is 2023-01-31
                excludeUsersSignedUpBefore: "2008-01-11",  // 5500 days before
                minUserAge: 500, // 2021-09-19 --> 500 days before  --> 5000 day range
                contribMaxAge: 1, // 2023-01-30
                contribMinAge: 1, // 2023-01-30
                contribSearchPeriodParts: 1,
                pageSize: 1,
            };
            const command = new UserAndContribSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            // 1 for Neptune, with the entire search date range
            // 100 for Jupiter, with 5000 days split into 10 days each
            // 1000 for Mercury, with 5000 days split into 5 day each
            // 5000 for Galileo, with 5000 days split into 1 day each
            expect(Object.keys(items)).to.have.lengthOf(1 + 100 + 1000 + 5000);
        });
        it('should create new process state, 5000 day signup range, 10 day contrib range, 2 contrib search period part, 1 sample location', function () {
            mockfs({
                '/tmp/foo/bar': {
                    '2023-01-02-00-00-00': {
                        'state.json': JSON.stringify({"completionDate": "2023-01-02-01-00-00"}),
                        'output-01.json':
                            '{"taskId": "foo2", "result": {"location": "Jupiter", "userCount": 1000}}' + "\n"
                    }
                }
            });

            const config:UserAndContribSearchConfig = {
                userCountPerLocationFilesDir: '/tmp/foo/bar',
                searchPeriodInDaysFor10000Users: 1,
                minRepositories: 1,
                minFollowers: 1,
                // today is 2023-01-31
                excludeUsersSignedUpBefore: "2008-01-11",  // 5500 days before
                minUserAge: 500, // 2021-09-19 --> 500 days before  --> 5000 day range
                contribMaxAge: 10, // 2023-01-21
                contribMinAge: 1, // 2023-01-30
                contribSearchPeriodParts: 2,
                pageSize: 1,
            };
            const command = new UserAndContribSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);

            // Combination of:
            // - 2 contrib search period parts, with 5 days earch
            // - 500 user signup period parts, with 10 days each
            // Total: 500*2 = 1000 tasks
            expect(Object.keys(items)).to.have.lengthOf(1000);


            // 1st user sign up date range, 1st contrib date range
            expect(findTasksForLocation(items, "Jupiter")[0].signedUpAfter).to.be.equal("2008-01-11");
            expect(findTasksForLocation(items, "Jupiter")[0].signedUpBefore).to.be.equal("2008-01-20");
            expect(findTasksForLocation(items, "Jupiter")[0].contribFromDate).to.be.equal("2023-01-21");
            expect(findTasksForLocation(items, "Jupiter")[0].contribToDate).to.be.equal("2023-01-25");
            // 1st user sign up date range, 2nd contrib date range
            expect(findTasksForLocation(items, "Jupiter")[1].signedUpAfter).to.be.equal("2008-01-11");
            expect(findTasksForLocation(items, "Jupiter")[1].signedUpBefore).to.be.equal("2008-01-20");
            expect(findTasksForLocation(items, "Jupiter")[1].contribFromDate).to.be.equal("2023-01-26");
            expect(findTasksForLocation(items, "Jupiter")[1].contribToDate).to.be.equal("2023-01-30");

            // last user sign up date range, last contrib date range
            expect(findTasksForLocation(items, "Jupiter")[999].signedUpAfter).to.be.equal("2021-09-09");
            expect(findTasksForLocation(items, "Jupiter")[999].signedUpBefore).to.be.equal("2021-09-18");
            expect(findTasksForLocation(items, "Jupiter")[999].contribFromDate).to.be.equal("2023-01-26");
            expect(findTasksForLocation(items, "Jupiter")[999].contribToDate).to.be.equal("2023-01-30");
        });
    });
});

