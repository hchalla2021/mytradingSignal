#!/bin/bash
set -e

echo "Starting backend server from $(pwd)"
cd backend || exit 1
echo "Changed to backend directory: $(pwd)"
export PYTHONPATH=$(pwd)
echo "Starting uvicorn on port ${PORT:-8000}"
exec python -m uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
