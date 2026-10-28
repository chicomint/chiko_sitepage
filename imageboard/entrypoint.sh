#!/bin/sh
set -eu
# Initialize only ChikoChan's new upload directory. Original media stays read-only
# to the application; never recursively change an existing content volume.
mkdir -p "${CHIKO_MEDIA_DIR:-/data/chiko-media}"
chown node:node "${CHIKO_MEDIA_DIR:-/data/chiko-media}"
exec gosu node "$@"
