import assert from "assert";
import {existsSync, readFileSync, rmSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {main} from "./focusOrgExtract.js";

// disable logging for tests
log.setLevel("warn");

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('focusOrgExtraction', () => {
    describe('#main()', function () {
        it('should generate proper output', async function () {
            const outputDirectory = join(__dirname, "test-data", "output");
            if (existsSync(outputDirectory)) {
                rmSync(outputDirectory, {recursive: true, force: true})
            }

            await main({
                focusProjectCandidateSearchDataDirectory: join(__dirname, "test-data", "input"),
                outputDirectory: outputDirectory,
            });

            const generated = JSON.parse(readFileSync(join(__dirname, "test-data", "output", "2023-10-19-18-25-29", "focus-organizations.json"), 'utf-8'));

            const expectedOutput = JSON.parse(readFileSync(join(__dirname, "test-data", "org-extract-expected.json"), 'utf-8'));

            assert.deepEqual(generated, expectedOutput);
        });
    });
});
