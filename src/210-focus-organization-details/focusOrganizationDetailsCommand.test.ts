import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {parseDate} from "@opentr/cuttlecat/dist/utils.js";
import {expect} from "chai";
import mockfs, {restore as mockfsRestore} from "mock-fs";

import FocusOrganizationDetailsCommand, {FocusOrganizationDetailsConfig} from "./focusOrganizationDetails.js";

// disable logging for tests
log.setLevel("error");

const logger = log.createLogger("test");
const context = new TaskContext(<any>null, 0, logger, []);


function fakeNow():Date {
    return parseDate("2023-01-31");
}

describe('FocusOrganizationDetailsCommand unit test', () => {
    describe('#createNewQueueItems()', function () {
        afterEach(() => {
            mockfsRestore();
        });

        it('should create new queue items, 1 day range, 1 day interval', function () {
            mockfs({
                '/tmp/foo/focusProjectCandidateSearchDataDirectory': {
                    '2023-01-02-00-00-00': {
                        'foo.txt': "isn't really read",
                    }
                },
                '/tmp/foo/focusProjectExtractFilesDir': {
                    '2023-01-02-00-00-00': {
                        'state.json': JSON.stringify({"completionDate": "2023-01-02-01-00-00"}),
                        'focus-organizations.json':
                            '["org1"]' + "\n"
                    }
                }
            });

            const config:FocusOrganizationDetailsConfig = {
                focusProjectCandidateSearchDataDirectory: "/tmp/foo/focusProjectCandidateSearchDataDirectory",
                focusProjectExtractFilesDir: "/tmp/foo/focusProjectExtractFilesDir",
                pageSize: 1,
            };
            const command = new FocusOrganizationDetailsCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            expect(items).to.be.not.empty;
            expect(items).to.have.lengthOf(1);

            const task = items[0];
            // fixed
            expect(task.id).to.be.not.null;
            expect(task.parentId).to.be.null;
            expect(task.originatingTaskId).to.be.null;
            // depends on input
            expect(task.orgName).to.be.equal("org1");
            expect(task.startCursor).to.be.null;
            expect(task.pageSize).to.be.equal(config.pageSize);
        });
    });
});
