import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {parseDate} from "@opentr/cuttlecat/dist/utils.js";
import {expect} from "chai";

import FocusProjectCandidateSearchCommand, {
    FocusProjectCandidateSearchConfig,
    FocusProjectCandidateSearchTaskSpec
} from "./focusProjectCandidateSearch.js";

// disable logging for tests
log.setLevel("error");

const logger = log.createLogger("test");
const context = new TaskContext(<any>null, 0, logger, []);


function fakeNow():Date {
    return parseDate("2023-01-31");
}

function sortItemsByCreatedAfter(items:FocusProjectCandidateSearchTaskSpec[]) {
    items.sort((a, b) => {
        return a.createdAfter.localeCompare(b.createdAfter);
    });
}

describe('FocusProjectCandidateSearchCommand unit test', () => {
    describe('#createNewQueueItems()', function () {
        it('should create new queue items, 1 day range, 1 day interval', function () {
            const config:FocusProjectCandidateSearchConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-30",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 1,
                pageSize: 1,
            };
            const command = new FocusProjectCandidateSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            expect(items).to.be.not.empty;
            expect(items).to.have.lengthOf(1);

            const task = items[0];
            // fixed
            expect(task.id).to.be.not.null;
            expect(task.parentId).to.be.null;
            expect(task.originatingTaskId).to.be.null;
            // depends on input
            expect(task.minStars).to.be.equal(config.minStars);
            expect(task.minForks).to.be.equal(config.minForks);
            expect(task.minSizeInKb).to.be.equal(config.minSizeInKb);
            expect(task.startCursor).to.be.null;
            expect(task.pageSize).to.be.equal(config.pageSize);
            // built from input
            expect(task.hasActivityAfter).to.be.equal("2023-01-30");
            expect(task.createdAfter).to.be.equal("2023-01-30");
            expect(task.createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new queue items, 2 day range, 2 day interval', function () {
            const config:FocusProjectCandidateSearchConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-29",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 2,
                pageSize: 1,
            };
            const command = new FocusProjectCandidateSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            expect(items).to.be.not.empty;
            expect(items).to.have.lengthOf(1);

            const task = items[0];
            expect(task.hasActivityAfter).to.be.equal("2023-01-30");
            expect(task.createdAfter).to.be.equal("2023-01-29");
            expect(task.createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new queue items, 2 day range, 1 day interval', function () {
            const config:FocusProjectCandidateSearchConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-29",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 1,
                pageSize: 1,
            };
            const command = new FocusProjectCandidateSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            expect(items).to.be.not.empty;
            expect(items).to.have.lengthOf(2);

            // sort by createdAfter to make it easier to test
            sortItemsByCreatedAfter(items);

            // task 1
            expect(items[0].hasActivityAfter).to.be.equal("2023-01-30");
            expect(items[0].createdAfter).to.be.equal("2023-01-29");
            expect(items[0].createdBefore).to.be.equal("2023-01-29");

            // task 2
            expect(items[1].hasActivityAfter).to.be.equal("2023-01-30");
            expect(items[1].createdAfter).to.be.equal("2023-01-30");
            expect(items[1].createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new queue items, 30 day range, 5 day interval', function () {
            const config:FocusProjectCandidateSearchConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-01",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 5,
                pageSize: 1,
            };
            const command = new FocusProjectCandidateSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            expect(items).to.be.not.empty;
            expect(items).to.have.lengthOf(6);

            // sort by createdAfter to make it easier to test
            sortItemsByCreatedAfter(items);

            // task 1
            expect(items[0].hasActivityAfter).to.be.equal("2023-01-30");
            expect(items[0].createdAfter).to.be.equal("2023-01-01");
            expect(items[0].createdBefore).to.be.equal("2023-01-05");

            // task 5
            expect(items[5].hasActivityAfter).to.be.equal("2023-01-30");
            expect(items[5].createdAfter).to.be.equal("2023-01-26");
            expect(items[5].createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new queue items, 10 day range, 7 day interval', function () {
            const config:FocusProjectCandidateSearchConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-21",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 7,
                pageSize: 1,
            };
            const command = new FocusProjectCandidateSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            expect(items).to.be.not.empty;
            expect(items).to.have.lengthOf(2);

            // sort by createdAfter to make it easier to test
            sortItemsByCreatedAfter(items);

            // task 1
            expect(items[0].hasActivityAfter).to.be.equal("2023-01-30");
            expect(items[0].createdAfter).to.be.equal("2023-01-21");
            expect(items[0].createdBefore).to.be.equal("2023-01-27");

            // task 2
            expect(items[1].hasActivityAfter).to.be.equal("2023-01-30");
            expect(items[1].createdAfter).to.be.equal("2023-01-28");
            expect(items[1].createdBefore).to.be.equal("2023-01-30");
        });
    });
});
