# update-changelog

## Usage

Create update-changelog.yml file:
```
name: Update Changelog file

on: [workflow_dispatch]

jobs:
  update-changelog-pull-request:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: jackstr/update-changelog@master
      - uses: jackstr/create-pull-request@master
```

Run the workflow:
```
# Get token at https://github.com/settings/tokens/new
curl \
    -u $user:$token \
    -X POST \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/repos/jackstr/seamly2d/actions/workflows/update-changelog.yml/dispatches \
    -d '{"ref": "develop"}' # branch name
```
