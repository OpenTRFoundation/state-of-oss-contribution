import {dirname, join} from "path";
import {fileURLToPath} from "url";
import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {parseDate} from "@opentr/cuttlecat/dist/utils.js";
import {expect} from "chai";

import UserCountSearchCommand, {UserCountSearchConfig, UserCountSearchTaskSpec} from "./userCountSearch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// disable logging for tests
log.setLevel("error");

const logger = log.createLogger("test");
const context = new TaskContext(<any>null, 0, logger, []);


function fakeNow():Date {
    return parseDate("2023-01-31");
}

function sortItemsByLocation(items:UserCountSearchTaskSpec[]) {
    items.sort((a, b) => {
        return a.location.localeCompare(b.location);
    });
}

describe('focusProjectCandidateSearch unit test', () => {
    describe('#createNewProcessState()', function () {
        it('should create new process state for ./test-data/locations-json file', function () {
            const config:UserCountSearchConfig = {
                locationJsonFile: join(__dirname, "test-data", "locations.json"),
                minFollowers: 1,
                minRepositories: 1,
            };
            const command = new UserCountSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            expect(items).to.be.not.empty;
            expect(items).to.have.lengthOf(3);

            sortItemsByLocation(items);

            for (let i = 0; i < items.length; i++) {
                // fixed
                const item = items[i];
                expect(item.id).to.be.not.null;
                expect(item.parentId).to.be.null;
                expect(item.originatingTaskId).to.be.null;
                // depends on input
                expect(item.minFollowers).to.be.equal(config.minFollowers);
                expect(item.minRepositories).to.be.equal(config.minRepositories);
            }

            expect(items[0].location).to.be.equal("Adana");
            expect(items[1].location).to.be.equal("TR");
            expect(items[2].location).to.be.equal("Turkey");
        });
        it('should create new process state for the sample output file of locationGeneration', function () {
            const config:UserCountSearchConfig = {
                locationJsonFile: join(__dirname, "..", "250-location-generation", "test-data", "locations.json"),
                minFollowers: 1,
                minRepositories: 1,
            };
            const command = new UserCountSearchCommand(config, fakeNow);
            const items = command.createNewQueueItems(context);
            expect(items).to.have.lengthOf(22);

            const locations = Object.values(items).map((o) => o.location);
            locations.sort(
                (a, b) => {
                    return a.localeCompare(b);
                }
            )

            expect(locations).to.deep.equal([
                "Adana",
                "Afyon",
                "Afyonkarahisar",
                "Afyonkarahısar",
                "Aladag",
                "Aladağ",
                "Basmakci",
                "Basmakçi",
                "Başmakci",
                "Başmakçi",
                "Basmakcı",
                "Basmakçı",
                "Başmakcı",
                "Başmakçı",
                "Ceyhan",
                "TR",
                "Turkey",
                "Turkiye",
                "Türkiye",
                "Turkıye",
                "Türkıye",
                "Zonguldak",
            ]);
        });
        it('should throw error when location file does not exist', function () {
            const config:UserCountSearchConfig = {
                locationJsonFile: join(__dirname, "test-data", "i-do-not-exist.json"),
                minFollowers: 1,
                minRepositories: 1,
            };
            const command = new UserCountSearchCommand(config, fakeNow);
            expect(() => {
                command.createNewQueueItems(context);
            }).to.throw(Error);
        });
    });
});
