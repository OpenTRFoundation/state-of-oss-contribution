import {dirname, join} from "path";
import {fileURLToPath} from "url";

import nock from "nock";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function initializeNockBack() {
    nock.back.fixtures = join(__dirname, '/fixtures');
    nock.back.setMode('lockdown');
}
