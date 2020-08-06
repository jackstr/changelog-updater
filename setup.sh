#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_FILE_NAME="$(basename "$0")"
readonly SCRIPT_FILE_PATH="$SCRIPT_DIR_PATH/$SCRIPT_FILE_NAME"

readonly baseDirPath=$(realpath -e $SCRIPT_DIR_PATH)

pushd $baseDirPath > /dev/null

# https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action
#
npm init -y

cat > action.yml <<'EOF'
name: 'Hello World'
description: 'Greet someone and record the time'
inputs:
  who-to-greet:  # id of input
    description: 'Who to greet'
    required: true
    default: 'World'
outputs:
  time: # id of output
    description: 'The time we greeted you'
runs:
  using: 'node12'
  main: 'index.js'
EOF

npm install @actions/core
npm install @actions/github

tsc --init
