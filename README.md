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


TODO:
- Unit tests
- Mock tests
- ESLint
- NPM publish?
