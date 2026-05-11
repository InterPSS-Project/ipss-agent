#!/usr/bin/env bash

set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")" && pwd -P)"
WRAPPER_PROPS="${BASE_DIR}/.mvn/wrapper/maven-wrapper.properties"
MVNW_REPOURL="${MVNW_REPOURL:-https://repo.maven.apache.org/maven2}"
MVNW_DIST_DIR="${BASE_DIR}/.mvn/wrapper/dists"

if [ ! -f "${WRAPPER_PROPS}" ]; then
  echo "Missing Maven wrapper properties: ${WRAPPER_PROPS}" >&2
  exit 1
fi

read_property() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { sub(/^[ \t]+/, "", $2); sub(/[ \t]+$/, "", $2); print $2 }' "${WRAPPER_PROPS}"
}

distribution_url="$(read_property distributionUrl)"
if [ -z "${distribution_url}" ]; then
  echo "Missing distributionUrl in ${WRAPPER_PROPS}" >&2
  exit 1
fi

distribution_url="${distribution_url/\$\{MVNW_REPOURL\}/${MVNW_REPOURL}}"
archive_name="${distribution_url##*/}"
dist_name="${archive_name%-bin.zip}"
maven_home="${MVNW_DIST_DIR}/${dist_name}"
maven_bin="${maven_home}/bin/mvn"
archive_path="${MVNW_DIST_DIR}/${archive_name}"

download() {
  local url="$1"
  local target="$2"

  mkdir -p "$(dirname "${target}")"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" -o "${target}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "${url}" -O "${target}"
  else
    echo "Need curl or wget to download Maven distribution." >&2
    exit 1
  fi
}

if [ ! -x "${maven_bin}" ]; then
  echo "Downloading Maven ${dist_name#apache-maven-}..." >&2
  download "${distribution_url}" "${archive_path}"
  rm -rf "${maven_home}"
  unzip -q "${archive_path}" -d "${MVNW_DIST_DIR}"
fi

exec "${maven_bin}" "$@"
