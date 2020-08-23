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
      # Make changes in the source code using `update-changlog`.
      - uses: jackstr/update-changelog@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      # Send changes as pull request using `create-pull-request`.
      - uses: jackstr/create-pull-request@master
        with:
          branch: update-changelog
          branch-suffix: timestamp
          title: Update CHANGELOG.md
          body: |
            Updates CHANGELOG with latest versions.

            This is automatically generated pull request.
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
