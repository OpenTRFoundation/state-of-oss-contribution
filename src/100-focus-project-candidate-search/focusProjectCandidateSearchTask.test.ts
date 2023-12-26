import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {
    FocusProjectCandidateSearchTask,
    FocusProjectCandidateSearchTaskResult,
    FocusProjectCandidateSearchTaskSpec,
    QUERY
} from "./focusProjectCandidateSearch.js";

// disable logging for tests
log.setLevel("error");

chai.use(chaiAsPromised);

const logger = log.createLogger("test");

describe('focusProjectCandidateSearchTask', () => {
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

            const spec:FocusProjectCandidateSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: "beefdead",
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-01",
                pageSize: 5,
                startCursor: "start",
            };

            const task = new FocusProjectCandidateSearchTask(spec);
            const response = await task.execute(context, signal);

            expect(response).to.be.equal(output);
            expect(executedQuery).to.be.equal(QUERY);
            expect(passedVariables).to.be.deep.equal({
                "searchString": "is:public template:false archived:false stars:>=5 forks:>=5 size:>=5 pushed:>=2023-01-01 created:2023-01-01..2023-01-01",
                "first": 5,
                "after": "start",
            });
        });
    });
    describe('#nextTask()', function () {
        it('should return a task, if next page exists', function () {
            const spec:FocusProjectCandidateSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-01",
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

            const context = new TaskContext(<any>null, 0, logger, []);
            const nextTask = new FocusProjectCandidateSearchTask(spec).nextTask(context, output) as FocusProjectCandidateSearchTask;
            expect(nextTask).to.be.not.null;

            // fixed
            const nextTaskSpec = nextTask.getSpec(context);
            expect(nextTaskSpec.parentId).to.be.null;
            expect(nextTaskSpec.minStars).to.be.equal(5);
            expect(nextTaskSpec.minForks).to.be.equal(5);
            expect(nextTaskSpec.minSizeInKb).to.be.equal(5);
            expect(nextTaskSpec.hasActivityAfter).to.be.equal("2023-01-01");
            expect(nextTaskSpec.createdAfter).to.be.equal("2023-01-01");
            expect(nextTaskSpec.createdBefore).to.be.equal("2023-01-01");
            expect(nextTaskSpec.pageSize).to.be.equal(5);

            // changed
            expect(nextTaskSpec.originatingTaskId).to.be.equal("deadbeef");
            expect(nextTaskSpec.startCursor).to.be.equal("end");
        });
        it('should not return anything, if next page does not exist', function () {
            const spec:any = {};

            const output:FocusProjectCandidateSearchTaskResult = {
                search: {
                    pageInfo: {
                        startCursor: "foobar",
                        hasNextPage: false,
                        endCursor: null,
                    },
                    repositoryCount: 0,
                    nodes: [],
                }
            };

            const context = new TaskContext(<any>null, 0, logger, []);
            const nextTask:FocusProjectCandidateSearchTask = new FocusProjectCandidateSearchTask(spec).nextTask(context, output) as FocusProjectCandidateSearchTask;
            expect(nextTask).to.be.null;
        });
    });
    describe('#narrowedDownTasks()', function () {
        it('should return tasks, when interval is even', function () {
            const spec:FocusProjectCandidateSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-10",
                pageSize: 5,
                startCursor: null,
            };
            const context = new TaskContext(<any>null, 0, logger, []);
            const tasks:FocusProjectCandidateSearchTask[] = new FocusProjectCandidateSearchTask(spec).narrowedDownTasks(context) as FocusProjectCandidateSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            // fixed
            const spec0 = tasks[0].getSpec(context);
            expect(spec0.originatingTaskId).to.be.null;
            expect(spec0.minStars).to.be.equal(5);
            expect(spec0.minForks).to.be.equal(5);
            expect(spec0.minSizeInKb).to.be.equal(5);
            expect(spec0.hasActivityAfter).to.be.equal("2023-01-01");
            expect(spec0.pageSize).to.be.equal(5);
            expect(spec0.startCursor).to.be.null;
            // changed
            expect(spec0.parentId).to.be.equal("deadbeef");
            expect(spec0.createdAfter).to.be.equal("2023-01-01");
            expect(spec0.createdBefore).to.be.equal("2023-01-05");

            // fixed
            const spec1 = tasks[1].getSpec(context);
            expect(spec1.originatingTaskId).to.be.null;
            expect(spec1.minStars).to.be.equal(5);
            expect(spec1.minForks).to.be.equal(5);
            expect(spec1.minSizeInKb).to.be.equal(5);
            expect(spec1.hasActivityAfter).to.be.equal("2023-01-01");
            expect(spec1.pageSize).to.be.equal(5);
            expect(spec1.startCursor).to.be.null;
            // changed
            expect(spec1.parentId).to.be.equal("deadbeef");
            expect(spec1.createdAfter).to.be.equal("2023-01-06");
            expect(spec1.createdBefore).to.be.equal("2023-01-10");
        });
        it('should return tasks, when interval is odd', function () {
            const spec:FocusProjectCandidateSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-11",
                pageSize: 5,
                startCursor: null,
            };
            const context = new TaskContext(<any>null, 0, logger, []);
            const tasks:FocusProjectCandidateSearchTask[] = new FocusProjectCandidateSearchTask(spec).narrowedDownTasks(context) as FocusProjectCandidateSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            const spec0 = tasks[0].getSpec(context);
            expect(spec0.parentId).to.be.equal("deadbeef");
            expect(spec0.createdAfter).to.be.equal("2023-01-01");
            expect(spec0.createdBefore).to.be.equal("2023-01-06");

            const spec1 = tasks[1].getSpec(context);
            expect(spec1.parentId).to.be.equal("deadbeef");
            expect(spec1.createdAfter).to.be.equal("2023-01-07");
            expect(spec1.createdBefore).to.be.equal("2023-01-11");
        });
        it('should return tasks, for a task with start cursor', function () {
            const spec:FocusProjectCandidateSearchTaskSpec = {
                id: "deadbeef",
                parentId: "parent",
                originatingTaskId: "beefdead",
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-02",
                pageSize: 5,
                startCursor: "start",
            };
            const context = new TaskContext(<any>null, 0, logger, []);
            const tasks:FocusProjectCandidateSearchTask[] = new FocusProjectCandidateSearchTask(spec).narrowedDownTasks(context) as FocusProjectCandidateSearchTask[];
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            const spec0 = tasks[0].getSpec(context);
            expect(spec0.originatingTaskId).to.be.equal("beefdead");
            expect(spec0.startCursor).to.be.null;
            expect(spec0.parentId).to.be.equal("deadbeef");
            expect(spec0.createdAfter).to.be.equal("2023-01-01");
            expect(spec0.createdBefore).to.be.equal("2023-01-01");

            const spec1 = tasks[1].getSpec(context);
            expect(spec1.originatingTaskId).to.be.equal("beefdead");
            expect(spec1.startCursor).to.be.null;
            expect(spec1.parentId).to.be.equal("deadbeef");
            expect(spec1.createdAfter).to.be.equal("2023-01-02");
            expect(spec1.createdBefore).to.be.equal("2023-01-02");
        });
        it('should not return anything, for a task with a single day period', function () {
            const spec:FocusProjectCandidateSearchTaskSpec = {
                id: "deadbeef",
                parentId: "parent",
                originatingTaskId: "beefdead",
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-01",
                pageSize: 5,
                startCursor: "start",
            };
            const context = new TaskContext(<any>null, 0, logger, []);
            const tasks:FocusProjectCandidateSearchTask[] = new FocusProjectCandidateSearchTask(spec).narrowedDownTasks(context) as FocusProjectCandidateSearchTask[];
            expect(tasks).to.be.null;
        });
    });
});
