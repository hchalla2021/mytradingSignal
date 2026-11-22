#!/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
export PROJECT_PATH="$TEST_DIR/project"
export OPENINGEDGE_VENV_BIN="$PROJECT_PATH/backend/venv/bin"
export TEST_LOG="$TEST_DIR/commands"
export MSYS2_ENV_CONV_EXCL=PROJECT_PATH
mkdir -p "$OPENINGEDGE_VENV_BIN" "$PROJECT_PATH/openingedge"
touch "$PROJECT_PATH/openingedge/main.py"
printf '#!/bin/bash\nexit 0\n' > "$OPENINGEDGE_VENV_BIN/uvicorn"
printf '#!/bin/bash\nexit 0\n' > "$OPENINGEDGE_VENV_BIN/python"
chmod +x "$OPENINGEDGE_VENV_BIN/python" "$OPENINGEDGE_VENV_BIN/uvicorn"

pm2() {
    echo "$*" >> "$TEST_LOG"
    if [ "$1" = jlist ]; then
        case "$TEST_STATE" in
            missing) echo '[]' ;;
            foreign) echo '[{"name":"openingedge","pm2_env":{"pm_cwd":"/different","args":["main:app"],"status":"online"}}]' ;;
            *) printf '[{"name":"openingedge","pm2_env":{"pm_cwd":"%s","args":["openingedge.main:app"],"status":"%s"}}]\n' "$PROJECT_PATH" "$TEST_STATE" ;;
        esac
    fi
}
curl() {
    if [[ "$*" == *'/health'* ]]; then
        [ "$TEST_OCCUPIED" = true ] || return 7
        echo '{"ok":true}'
    elif [ "$TEST_READY" = true ]; then
        echo '{"automation_on":false,"execution_status":"LOCKED"}'
    else
        echo '{"execution_status":"NOT IMPLEMENTED"}'
    fi
}
python3() { "$TEST_PYTHON" "$@"; }
sleep() { :; }
export -f pm2 curl python3 sleep

run_case() {
    export TEST_STATE="$1" TEST_OCCUPIED="$2" TEST_READY="$3"
    : > "$TEST_LOG"
    local code=0
    bash "$ROOT/scripts/ensure-openingedge.sh" > "$TEST_DIR/output" 2>&1 || code=$?
    if [ "$code" -ne "$4" ]; then
        cat "$TEST_DIR/output"
        echo "Unexpected exit for $TEST_STATE: $code"
        exit 1
    fi
}

run_case missing false true 0
grep -q '^start .*--name openingedge .*openingedge.main:app .*--port 8012' "$TEST_LOG"
grep -q '^save$' "$TEST_LOG"

run_case online false true 0
if grep -Eq '^(start|restart) ' "$TEST_LOG"; then exit 1; fi

run_case errored false true 0
grep -q '^restart openingedge$' "$TEST_LOG"

run_case missing true true 1
if grep -Eq '^(start|restart|save)' "$TEST_LOG"; then exit 1; fi

run_case foreign false true 1
if grep -Eq '^(start|restart|save)' "$TEST_LOG"; then exit 1; fi

run_case online false false 1
if grep -q '^save$' "$TEST_LOG"; then exit 1; fi

echo "6 OpeningEdge startup tests passed; no services or network calls used."
