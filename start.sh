#!/bin/bash
set -e

cd backend
exec python -m uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
