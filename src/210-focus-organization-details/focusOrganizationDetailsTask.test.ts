import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {
    FocusOrganizationDetailsTask,
    FocusOrganizationDetailsTaskResult,
    FocusOrganizationDetailsTaskSpec,
    QUERY
} from "./focusOrganizationDetails.js";

// disable logging for tests
log.setLevel("error");

chai.use(chaiAsPromised);

const logger = log.createLogger("test");

describe('FocusOrganizationDetailsTask', () => {
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

            const context = new TaskContext(fakeGraphql, 0, logger, []);

            const spec:FocusOrganizationDetailsTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: "beefdead",
                orgName: "OrgOne",
                pageSize: 5,
                startCursor: "start",
            };

            const task = new FocusOrganizationDetailsTask(spec);
            const response = await task.execute(context, signal);

            expect(response).to.be.equal(output);
            expect(executedQuery).to.be.equal(QUERY);
            expect(passedVariables).to.be.deep.equal({
                "orgName": "OrgOne",
                "first": 5,
                "after": "start",
            });
        });
    });
    describe('#nextTask()', function () {
        it('should return a task, if next page exists', function () {
            const spec:FocusOrganizationDetailsTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                orgName: "OrgOne",
                pageSize: 5,
                startCursor: null,
            };

            const output:any = {
                organization: {
                    login: "OrgOne",
                    name: "Org One",
                    createdAt: "2023-01-01T00:00:00Z",
                    membersWithRole: {
                        totalCount: 5,
                    },
                    repositories: {
                        pageInfo: {
                            startCursor: "foobar",
                            hasNextPage: true,
                            endCursor: "end",
                        },
                        nodes: [],
                    },
                },
            };

            const context = new TaskContext(<any>null, 0, logger, []);
            const nextTask = new FocusOrganizationDetailsTask(spec).nextTask(context, output) as FocusOrganizationDetailsTask;
            expect(nextTask).to.be.not.null;

            // fixed
            const nextTaskSpec = nextTask.getSpec(context);
            expect(nextTaskSpec.parentId).to.be.null;
            expect(nextTaskSpec.orgName).to.be.equal("OrgOne");
            expect(nextTaskSpec.pageSize).to.be.equal(5);

            // changed
            expect(nextTaskSpec.originatingTaskId).to.be.equal("deadbeef");
            expect(nextTaskSpec.startCursor).to.be.equal("end");
        });
        it('should not return anything, if next page does not exist', function () {
            const spec:any = {};

            const output:FocusOrganizationDetailsTaskResult = {
                organization: {
                    login: "OrgOne",
                    name: "Org One",
                    createdAt: "2023-01-01T00:00:00Z",
                    membersWithRole: {
                        totalCount: 5,
                    },
                    repositories: {
                        pageInfo: {
                            startCursor: "foobar",
                            hasNextPage: false,
                            endCursor: null,
                        },
                        nodes: [],
                    },
                },
            };

            const context = new TaskContext(<any>null, 0, logger, []);
            const nextTask:FocusOrganizationDetailsTask = new FocusOrganizationDetailsTask(spec).nextTask(context, output) as FocusOrganizationDetailsTask;
            expect(nextTask).to.be.null;
        });
    });
    describe('#narrowedDownTasks()', function () {
        it('should return tasks, when pageSize is even', function () {
            const spec:FocusOrganizationDetailsTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                orgName: "OrgOne",
                pageSize: 5,
                startCursor: null,
            };
            const context = new TaskContext(<any>null, 0, logger, []);
            const tasks:FocusOrganizationDetailsTask[] = new FocusOrganizationDetailsTask(spec).narrowedDownTasks(context) as FocusOrganizationDetailsTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(1);

            const newSpec = tasks[0].getSpec(context);
            expect(newSpec.originatingTaskId).to.be.null;
            expect(newSpec.orgName).to.be.equal("OrgOne");
            expect(newSpec.startCursor).to.be.null;
            // changed
            expect(newSpec.parentId).to.be.equal("deadbeef");
            expect(newSpec.pageSize).to.be.equal(2);
        });
        it('should return tasks, when pageSize is odd', function () {
            const spec:FocusOrganizationDetailsTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                orgName: "OrgOne",
                pageSize: 6,
                startCursor: null,
            };
            const context = new TaskContext(<any>null, 0, logger, []);
            const tasks:FocusOrganizationDetailsTask[] = new FocusOrganizationDetailsTask(spec).narrowedDownTasks(context) as FocusOrganizationDetailsTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(1);

            const newSpec = tasks[0].getSpec(context);
            expect(newSpec.originatingTaskId).to.be.null;
            expect(newSpec.orgName).to.be.equal("OrgOne");
            expect(newSpec.startCursor).to.be.null;
            // changed
            expect(newSpec.parentId).to.be.equal("deadbeef");
            expect(newSpec.pageSize).to.be.equal(3);
        });
        it('should return tasks, for a task with start cursor', function () {
            const spec:FocusOrganizationDetailsTaskSpec = {
                id: "deadbeef",
                parentId: "parent",
                originatingTaskId: "beefdead",
                orgName: "OrgOne",
                pageSize: 5,
                startCursor: "start",
            };
            const context = new TaskContext(<any>null, 0, logger, []);
            const tasks:FocusOrganizationDetailsTask[] = new FocusOrganizationDetailsTask(spec).narrowedDownTasks(context) as FocusOrganizationDetailsTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(1);

            const newSpec = tasks[0].getSpec(context);
            expect(newSpec.originatingTaskId).to.be.equal("beefdead");
            expect(newSpec.startCursor).to.be.equal("start");
            expect(newSpec.parentId).to.be.equal("deadbeef");
        });
    });
});
