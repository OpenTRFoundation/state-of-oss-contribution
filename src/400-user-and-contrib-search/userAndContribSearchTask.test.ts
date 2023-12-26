import {graphql} from "@octokit/graphql";
import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {QUERY, UserAndContribSearchTask, UserAndContribSearchTaskSpec} from "./userAndContribSearch.js";

// disable logging for tests
log.setLevel("error");

chai.use(chaiAsPromised);

const logger = log.createLogger("test");

describe('userAndContribSearch Task', () => {
    describe('#execute()', function () {
        it('should return proper response', async () => {
            const signal = new AbortController().signal;
            const output:any = {
                "foo": "bar",
            };

            let executedQuery = "";
            let passedVariables = {};

            const fakeGraphql:any = {
                defaults: () => {
                    return (query:string, variables:object) => {
                        executedQuery = query;
                        passedVariables = variables;
                        return Promise.resolve(output);
                    }
                }
            };

            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: "beefdead",
                //
                minRepositories: 1,
                minFollowers: 1,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-01",
                contribFromDate: "2023-01-01",
                contribToDate: "2023-01-01",
                //
                pageSize: 5,
                startCursor: "start",
            };

            const context = new TaskContext(fakeGraphql, 0, logger, []);
            const task = new UserAndContribSearchTask(spec);
            const response = await task.execute(context, signal);

            expect(response).to.be.equal(output);
            expect(executedQuery).to.be.equal(QUERY);
            expect(passedVariables).to.be.deep.equal({
                "after": "start",
                "contribFrom": "2023-01-01T00:00:00+00:00",
                "contribTo": "2023-01-01T23:59:59+00:00",
                "first": 5,
                "searchString": "location:Earth followers:>=1 repos:>=1 created:2023-01-01..2023-01-01",
            });
        });
    });
    describe('#nextTask()', function () {
        it('should create a task, if next page exists', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-02",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-04",
                //
                pageSize: 5,
                startCursor: null,
            };

            const output:any = {
                search: {
                    pageInfo: {
                        hasNextPage: true,
                        endCursor: "end",
                    }
                }
            };

            const context = new TaskContext(graphql, 0, logger, []);
            const nextTask = new UserAndContribSearchTask(spec).nextTask(context, output) as UserAndContribSearchTask;
            expect(nextTask, "next task can't be null").to.be.not.null;

            // fixed
            const nextTaskSpec = nextTask.getSpec(context);
            expect(nextTaskSpec.parentId).to.be.null;
            expect(nextTaskSpec.minRepositories).to.be.equal(5);
            expect(nextTaskSpec.minFollowers).to.be.equal(10);
            expect(nextTaskSpec.location).to.be.equal("Earth");
            expect(nextTaskSpec.signedUpAfter).to.be.equal("2023-01-01");
            expect(nextTaskSpec.signedUpBefore).to.be.equal("2023-01-02");
            expect(nextTaskSpec.contribFromDate).to.be.equal("2023-01-03");
            expect(nextTaskSpec.contribToDate).to.be.equal("2023-01-04");
            expect(nextTaskSpec.pageSize).to.be.equal(5);

            // changed
            expect(nextTaskSpec.originatingTaskId).to.be.equal("deadbeef");
            expect(nextTaskSpec.startCursor).to.be.equal("end");
        });
        it('should not return anything, if next page does not exist', function () {
            const spec:any = {};

            const output:any = {
                search: {
                    pageInfo: {
                        hasNextPage: false,
                        endCursor: null,
                    }
                }
            };

            const context = new TaskContext(graphql, 0, logger, []);
            const nextTask:UserAndContribSearchTask = new UserAndContribSearchTask(spec).nextTask(context, output) as UserAndContribSearchTask;
            expect(nextTask).to.be.null;
        });
    });
    describe('#narrowedDownTasks()', function () {
        it('should return tasks, when signup interval is even, contrib interval is 1 day', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-10",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-03",
                //
                pageSize: 5,
                startCursor: null,
            };

            const context = new TaskContext(graphql, 0, logger, []);
            const tasks:UserAndContribSearchTask[] = new UserAndContribSearchTask(spec).narrowedDownTasks(context) as UserAndContribSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            // fixed
            const newTaskSpec0 = tasks[0].getSpec(context);
            expect(newTaskSpec0.originatingTaskId).to.be.null;
            expect(newTaskSpec0.minRepositories).to.be.equal(5);
            expect(newTaskSpec0.minFollowers).to.be.equal(10);
            expect(newTaskSpec0.location).to.be.equal("Earth");
            expect(newTaskSpec0.pageSize).to.be.equal(5);
            expect(newTaskSpec0.startCursor).to.be.null;
            // changed
            expect(newTaskSpec0.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec0.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec0.signedUpBefore).to.be.equal("2023-01-05");
            // not split
            expect(newTaskSpec0.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec0.contribToDate).to.be.equal("2023-01-03");

            // fixed
            const newTaskSpec1 = tasks[1].getSpec(context);
            expect(newTaskSpec1.originatingTaskId).to.be.null;
            expect(newTaskSpec1.minRepositories).to.be.equal(5);
            expect(newTaskSpec1.minFollowers).to.be.equal(10);
            expect(newTaskSpec1.location).to.be.equal("Earth");
            expect(newTaskSpec1.pageSize).to.be.equal(5);
            expect(newTaskSpec1.startCursor).to.be.null;
            // changed
            expect(newTaskSpec1.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec1.signedUpAfter).to.be.equal("2023-01-06");
            expect(newTaskSpec1.signedUpBefore).to.be.equal("2023-01-10");
            // not split
            expect(newTaskSpec1.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec1.contribToDate).to.be.equal("2023-01-03");
        });
        it('should return tasks, when signup interval is odd, contrib interval is 1 day', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-11",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-03",
                //
                pageSize: 5,
                startCursor: null,
            };
            const context = new TaskContext(graphql, 0, logger, []);
            const tasks:UserAndContribSearchTask[] = new UserAndContribSearchTask(spec).narrowedDownTasks(context) as UserAndContribSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            const newTaskSpec0 = tasks[0].getSpec(context);
            expect(newTaskSpec0.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec0.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec0.signedUpBefore).to.be.equal("2023-01-06");
            // not split
            expect(newTaskSpec0.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec0.contribToDate).to.be.equal("2023-01-03");

            const newTaskSpec1 = tasks[1].getSpec(context);
            expect(newTaskSpec1.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec1.signedUpAfter).to.be.equal("2023-01-07");
            expect(newTaskSpec1.signedUpBefore).to.be.equal("2023-01-11");
            // not split
            expect(newTaskSpec1.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec1.contribToDate).to.be.equal("2023-01-03");
        });
        it('should return tasks, for a task with start cursor', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: "parent",
                originatingTaskId: "beefdead",
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-02",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-03",
                //
                pageSize: 5,
                startCursor: "start",
            };
            const context = new TaskContext(graphql, 0, logger, []);
            const tasks:UserAndContribSearchTask[] = new UserAndContribSearchTask(spec).narrowedDownTasks(context) as UserAndContribSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            const newTaskSpec0 = tasks[0].getSpec(context);
            expect(newTaskSpec0.originatingTaskId).to.be.equal("beefdead");
            expect(newTaskSpec0.startCursor).to.be.null;
            expect(newTaskSpec0.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec0.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec0.signedUpBefore).to.be.equal("2023-01-01");
            // not split
            expect(newTaskSpec0.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec0.contribToDate).to.be.equal("2023-01-03");

            const newTaskSpec1 = tasks[1].getSpec(context);
            expect(newTaskSpec1.originatingTaskId).to.be.equal("beefdead");
            expect(newTaskSpec1.startCursor).to.be.null;
            expect(newTaskSpec1.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec1.signedUpAfter).to.be.equal("2023-01-02");
            expect(newTaskSpec1.signedUpBefore).to.be.equal("2023-01-02");
            // not split
            expect(newTaskSpec0.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec0.contribToDate).to.be.equal("2023-01-03");
        });
        it('should not return anything, when signup interval and contrib interval is 1 day', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: "parent",
                originatingTaskId: "beefdead",
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-01",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-03",
                //
                pageSize: 1,
                startCursor: "start",
            };
            const context = new TaskContext(graphql, 0, logger, []);
            const tasks:UserAndContribSearchTask[] = new UserAndContribSearchTask(spec).narrowedDownTasks(context) as UserAndContribSearchTask[];
            expect(tasks).to.be.null;
        });
        it('should return tasks, when signup interval is even, contrib interval is even', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-10",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-12",
                //
                pageSize: 5,
                startCursor: null,
            };
            const context = new TaskContext(graphql, 0, logger, []);
            const tasks:UserAndContribSearchTask[] = new UserAndContribSearchTask(spec).narrowedDownTasks(context) as UserAndContribSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(4);

            const newTaskSpec0 = tasks[0].getSpec(context);
            expect(newTaskSpec0.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec0.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec0.signedUpBefore).to.be.equal("2023-01-05");
            expect(newTaskSpec0.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec0.contribToDate).to.be.equal("2023-01-07");

            const newTaskSpec1 = tasks[1].getSpec(context);
            expect(newTaskSpec1.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec1.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec1.signedUpBefore).to.be.equal("2023-01-05");
            expect(newTaskSpec1.contribFromDate).to.be.equal("2023-01-08");
            expect(newTaskSpec1.contribToDate).to.be.equal("2023-01-12");

            const newTaskSpec2 = tasks[2].getSpec(context);
            expect(newTaskSpec2.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec2.signedUpAfter).to.be.equal("2023-01-06");
            expect(newTaskSpec2.signedUpBefore).to.be.equal("2023-01-10");
            expect(newTaskSpec2.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec2.contribToDate).to.be.equal("2023-01-07");

            const newTaskSpec3 = tasks[3].getSpec(context);
            expect(newTaskSpec3.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec3.signedUpAfter).to.be.equal("2023-01-06");
            expect(newTaskSpec3.signedUpBefore).to.be.equal("2023-01-10");
            expect(newTaskSpec3.contribFromDate).to.be.equal("2023-01-08");
            expect(newTaskSpec3.contribToDate).to.be.equal("2023-01-12");
        });
        it('should return tasks, when signup interval is even, contrib interval is odd', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-11",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-09",
                //
                pageSize: 5,
                startCursor: null,
            };
            const context = new TaskContext(graphql, 0, logger, []);
            const tasks:UserAndContribSearchTask[] = new UserAndContribSearchTask(spec).narrowedDownTasks(context) as UserAndContribSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(4);

            const newTaskSpec0 = tasks[0].getSpec(context);
            expect(newTaskSpec0.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec0.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec0.signedUpBefore).to.be.equal("2023-01-06");
            expect(newTaskSpec0.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec0.contribToDate).to.be.equal("2023-01-06");

            const newTaskSpec1 = tasks[1].getSpec(context);
            expect(newTaskSpec1.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec1.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec1.signedUpBefore).to.be.equal("2023-01-06");
            expect(newTaskSpec1.contribFromDate).to.be.equal("2023-01-07");
            expect(newTaskSpec1.contribToDate).to.be.equal("2023-01-09");

            const newTaskSpec2 = tasks[2].getSpec(context);
            expect(newTaskSpec2.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec2.signedUpAfter).to.be.equal("2023-01-07");
            expect(newTaskSpec2.signedUpBefore).to.be.equal("2023-01-11");
            expect(newTaskSpec2.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec2.contribToDate).to.be.equal("2023-01-06");

            const newTaskSpec3 = tasks[3].getSpec(context);
            expect(newTaskSpec3.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec3.signedUpAfter).to.be.equal("2023-01-07");
            expect(newTaskSpec3.signedUpBefore).to.be.equal("2023-01-11");
            expect(newTaskSpec3.contribFromDate).to.be.equal("2023-01-07");
            expect(newTaskSpec3.contribToDate).to.be.equal("2023-01-09");
        });
        it('should return tasks, when signup interval is odd, contrib interval is even', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-10",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-13",
                //
                pageSize: 5,
                startCursor: null,
            };
            const context = new TaskContext(graphql, 0, logger, []);
            const tasks:UserAndContribSearchTask[] = new UserAndContribSearchTask(spec).narrowedDownTasks(context) as UserAndContribSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(4);

            const newTaskSpec0 = tasks[0].getSpec(context);
            expect(newTaskSpec0.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec0.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec0.signedUpBefore).to.be.equal("2023-01-05");
            expect(newTaskSpec0.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec0.contribToDate).to.be.equal("2023-01-08");

            const newTaskSpec1 = tasks[1].getSpec(context);
            expect(newTaskSpec1.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec1.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec1.signedUpBefore).to.be.equal("2023-01-05");
            expect(newTaskSpec1.contribFromDate).to.be.equal("2023-01-09");
            expect(newTaskSpec1.contribToDate).to.be.equal("2023-01-13");

            const newTaskSpec2 = tasks[2].getSpec(context);
            expect(newTaskSpec2.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec2.signedUpAfter).to.be.equal("2023-01-06");
            expect(newTaskSpec2.signedUpBefore).to.be.equal("2023-01-10");
            expect(newTaskSpec2.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec2.contribToDate).to.be.equal("2023-01-08");

            const newTaskSpec3 = tasks[3].getSpec(context);
            expect(newTaskSpec3.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec3.signedUpAfter).to.be.equal("2023-01-06");
            expect(newTaskSpec3.signedUpBefore).to.be.equal("2023-01-10");
            expect(newTaskSpec3.contribFromDate).to.be.equal("2023-01-09");
            expect(newTaskSpec3.contribToDate).to.be.equal("2023-01-13");
        });
        it('should return tasks, when signup interval is odd, contrib interval is odd', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-10",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-12",
                //
                pageSize: 5,
                startCursor: null,
            };
            const context = new TaskContext(graphql, 0, logger, []);
            const tasks:UserAndContribSearchTask[] = new UserAndContribSearchTask(spec).narrowedDownTasks(context) as UserAndContribSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(4);

            const newTaskSpec0 = tasks[0].getSpec(context);
            expect(newTaskSpec0.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec0.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec0.signedUpBefore).to.be.equal("2023-01-05");
            expect(newTaskSpec0.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec0.contribToDate).to.be.equal("2023-01-07");

            const newTaskSpec1 = tasks[1].getSpec(context);
            expect(newTaskSpec1.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec1.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec1.signedUpBefore).to.be.equal("2023-01-05");
            expect(newTaskSpec1.contribFromDate).to.be.equal("2023-01-08");
            expect(newTaskSpec1.contribToDate).to.be.equal("2023-01-12");

            const newTaskSpec2 = tasks[2].getSpec(context);
            expect(newTaskSpec2.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec2.signedUpAfter).to.be.equal("2023-01-06");
            expect(newTaskSpec2.signedUpBefore).to.be.equal("2023-01-10");
            expect(newTaskSpec2.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec2.contribToDate).to.be.equal("2023-01-07");

            const newTaskSpec3 = tasks[3].getSpec(context);
            expect(newTaskSpec3.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec3.signedUpAfter).to.be.equal("2023-01-06");
            expect(newTaskSpec3.signedUpBefore).to.be.equal("2023-01-10");
            expect(newTaskSpec3.contribFromDate).to.be.equal("2023-01-08");
            expect(newTaskSpec3.contribToDate).to.be.equal("2023-01-12");
        });
        it('should return tasks, when signup interval is 1 day, contrib interval is longer', function () {
            const spec:UserAndContribSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                //
                minRepositories: 5,
                minFollowers: 10,
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-01",
                contribFromDate: "2023-01-03",
                contribToDate: "2023-01-12",
                //
                pageSize: 5,
                startCursor: null,
            };
            const context = new TaskContext(graphql, 0, logger, []);
            const tasks:UserAndContribSearchTask[] = new UserAndContribSearchTask(spec).narrowedDownTasks(context) as UserAndContribSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            const newTaskSpec0 = tasks[0].getSpec(context);
            expect(newTaskSpec0.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec0.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec0.signedUpBefore).to.be.equal("2023-01-01");
            expect(newTaskSpec0.contribFromDate).to.be.equal("2023-01-03");
            expect(newTaskSpec0.contribToDate).to.be.equal("2023-01-07");

            const newTaskSpec1 = tasks[1].getSpec(context);
            expect(newTaskSpec1.parentId).to.be.equal("deadbeef");
            expect(newTaskSpec1.signedUpAfter).to.be.equal("2023-01-01");
            expect(newTaskSpec1.signedUpBefore).to.be.equal("2023-01-01");
            expect(newTaskSpec1.contribFromDate).to.be.equal("2023-01-08");
            expect(newTaskSpec1.contribToDate).to.be.equal("2023-01-12");
        });
    });
});
