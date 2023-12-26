import assert from "assert";
import {readFileSync, rmSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {main} from "./locationGeneration.js";

// disable logging for tests
log.setLevel("warn");

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('locationGeneration', () => {
    describe('#main()', function () {
        it('should generate proper output', function () {
            rmSync(join(__dirname, "test-data", "locations.json"), {force: true});

            main({
                locationsMasterFile: join(__dirname, "test-data", "locations-master.json"),
                locationsAdditionalFile: join(__dirname, "test-data", "locations-additional.json"),
                locationsExcludeFile: join(__dirname, "test-data", "locations-exclude.json"),
                outputFile: join(__dirname, "test-data", "locations.json"),
            });

            const generated = JSON.parse(readFileSync(join(__dirname, "test-data", "locations.json"), 'utf-8'));

            const expectedOutput = JSON.parse(readFileSync(join(__dirname, "test-data", "locations-expected.json"), 'utf-8'));

            assert.deepEqual(generated, expectedOutput);
        });
    });
});
