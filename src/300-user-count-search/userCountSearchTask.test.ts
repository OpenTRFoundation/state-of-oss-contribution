import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {QUERY, UserCountSearchTask, UserCountSearchTaskSpec} from "./userCountSearch.js";

// disable logging for tests
log.setLevel("error");

chai.use(chaiAsPromised);

const logger = log.createLogger("test");

describe('userCountSearch Task', () => {
    describe('#execute()', function () {
        it('should return proper response', async () => {
            const signal = new AbortController().signal;
            const output:any = {
                "foo": "bar",
            };

            let executedQuery = "";
            let passedVariables = {};

            const fakeGraphql:any = {
                defaults: (_:any) => {
                    return (query:string, variables:object) => {
                        executedQuery = query;
                        passedVariables = variables;
                        return Promise.resolve(output);
                    }
                }
            };

            const spec:UserCountSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                minRepositories: 5,
                minFollowers: 5,
                location: "Venus",
            };

            const context = new TaskContext(fakeGraphql, 0, logger, []);
            const task = new UserCountSearchTask(spec);
            const response = await task.execute(context, signal);

            expect(response).to.be.equal(output);
            expect(executedQuery).to.be.equal(QUERY);
            expect(passedVariables).to.be.deep.equal({
                "searchString": "location:Venus repos:>=5 followers:>=5"
            });
        });
    });
});
