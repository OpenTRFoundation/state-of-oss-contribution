import assert from "assert";
import {existsSync, readFileSync, rmSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import * as log from "@opentr/cuttlecat/dist/log.js";
import {main} from "./focusRepositoryExtract.js";

// disable logging for tests
log.setLevel("warn");

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('focusRepositoryExtraction', () => {
    describe('#main()', function () {
        it('should generate proper output', async function () {
            const outputDirectory = join(__dirname, "test-data", "output");
            if (existsSync(outputDirectory)) {
                rmSync(outputDirectory, {recursive: true, force: true})
            }

            await main({
                focusProjectCandidateSearchDataDirectory: join(__dirname, "test-data", "input"),
                outputDirectory: outputDirectory,
                repositoryExcludeListFile: join(__dirname, "test-data", "repository-exclude-list.json"),
                organizationExcludeListFile: join(__dirname, "test-data", "organization-exclude-list.json"),
                minStars: 50,
                minForks: 50,
                minMentionableUsers: 50,
                minPullRequests: 50,
            });

            const generated = JSON.parse(readFileSync(join(__dirname, "test-data", "output", "2023-10-19-18-25-29", "focus-repositories.json"), 'utf-8'));

            const expectedOutput = JSON.parse(readFileSync(join(__dirname, "test-data", "repository-extract-expected.json"), 'utf-8'));

            assert.deepEqual(generated, expectedOutput);
        });
    });
});
