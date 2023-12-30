```shell
npm run build

rm -rf /tmp/foo/bar
mkdir -p /tmp/foo/bar

CWD="$(pwd)"

cuttlecat execute --command-file="${CWD}/dist/100-focus-project-candidate-search/focusProjectCandidateSearch.js" \
    --data-directory="/tmp/foo/bar" \
    --github-token="$(gh auth token)"
```

```shell
npm run build

CWD="$(pwd)"

node "${CWD}/dist/200-focus-project-extract/focusRepositoryExtractIndex.js" \
    --focus-project-candidate-search-data-directory="/tmp/foo/bar" \
    --exclude-list-file="${CWD}/200-focus-project-extract/repository-exclude-list.json" \
    --output-directory="${CWD}/200-focus-project-extract"
    
node "${CWD}/dist/200-focus-project-extract/focusOrgExtractIndex.js" \
    --focus-project-candidate-search-data-directory="/tmp/foo/bar" \
    --output-directory="${CWD}/200-focus-project-extract"
```

Requeue:
```shell
npm run build

CWD="$(pwd)"
node "${CWD}/node_modules/@opentr/cuttlecat/dist/index.js" requeue-tasks \
    --requeue-type="non-critical-errored" \
    --data-directory="${CWD}/100-focus-project-candidate-search" \
    --timestamp="2023-12-28-21-14-17"
    
node node_modules/@opentr/cuttlecat/dist/index.js execute \
    --command-file="${CWD}/dist/100-focus-project-candidate-search/focusProjectCandidateSearch.js" \
    --github-token="$(gh auth token)" \
    --data-directory="${CWD}/100-focus-project-candidate-search" \
    --interval-cap="7"
```

Truthmap:
```shell
npm run build
CWD="$(pwd)"

node "${CWD}/dist/900-report-data-truthmap/buildTruthMapsIndex.js" \
    --focus-project-candidate-search-data-directory="${CWD}/100-focus-project-candidate-search" \
    --focus-project-extract-data-directory="${CWD}/200-focus-project-extract" \
    --locations-file-path="${CWD}/250-location-generation/locations.json" \
    --location-resolution-rules-file-path="${CWD}/900-report-data-truthmap/input-location-resolution-rules.json" \
    --user-and-contrib-search-data-directory="${CWD}/400-user-and-contrib-search" \
    --output-directory="${CWD}/900-report-data-truthmap"
```

Debug data:
```shell
npm run build
CWD="$(pwd)"

node "${CWD}/dist/910-debug-data/debugDataIndex.js" \
    --user-count-search-data-directory="${CWD}/300-user-count-search" \
    --user-and-contrib-search-data-directory="${CWD}/400-user-and-contrib-search" \
    --output-directory="${CWD}/910-debug-data"
```

TODO:
- Unit tests
- Mock tests
- ESLint
- NPM publish?
