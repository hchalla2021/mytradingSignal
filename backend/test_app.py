#!/usr/bin/env python3.13
# Simple test script to check if app imports and runs

print("Starting import...")
try:
    from app import app
    print("Import successful!")
    print("App object:", app)
except Exception as e:
    print(f"Error during import: {e}")
    import traceback
    traceback.print_exc()
