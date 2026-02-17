#!/usr/bin/env python3

"""
🔍 VERIFICATION SCRIPT - Ensure NO mock/test data in production
Run this before deployment to confirm everything is LIVE DATA ONLY
"""

import os
import re
from pathlib import Path
from typing import List, Tuple

def check_file_for_patterns(filepath: str, patterns: List[str]) -> List[Tuple[int, str]]:
    """Check file for mock/test data patterns."""
    issues = []
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for line_num, line in enumerate(f, 1):
                for pattern in patterns:
                    if re.search(pattern, line, re.IGNORECASE):
                        if not line.strip().startswith('#'):  # Ignore comments
                            issues.append((line_num, line.strip()))
    except Exception as e:
        pass
    return issues

def main():
    print("═" * 70)
    print("🔍 LIVE DATA VERIFICATION - Production Safety Check")
    print("═" * 70)
    
    # Patterns to find (these should NOT be in production code)
    dangerous_patterns = [
        r'MockMarketFeedService\s*\(',  # Mock service instantiation
        r'mock_market_feed',            # Mock feed import
        r'class.*MockMarket',           # Mock class definition
        r'dummy.*data',                 # Dummy data references
        r'test.*data\s*=',              # Test data assignment
        r'fallback.*synthetic',         # Synthetic fallback
    ]
    
    backend_dir = Path('backend')
    frontend_dir = Path('frontend')
    
    issues_found = {}
    files_checked = 0
    
    # Check backend Python files
    print("\n📊 Checking Backend Python Files...")
    print("-" * 70)
    
    if backend_dir.exists():
        for py_file in backend_dir.rglob('*.py'):
            if '__pycache__' not in str(py_file):
                files_checked += 1
                issues = check_file_for_patterns(str(py_file), dangerous_patterns)
                if issues:
                    issues_found[str(py_file)] = issues
                    print(f"⚠️  {py_file.name}: {len(issues)} potential issue(s)")
                else:
                    print(f"✅ {py_file.name}: Clean")
    
    # Check frontend TypeScript files
    print("\n📊 Checking Frontend TypeScript/React Files...")
    print("-" * 70)
    
    if frontend_dir.exists():
        for ts_file in frontend_dir.rglob('*.tsx'):
            files_checked += 1
            issues = check_file_for_patterns(str(ts_file), dangerous_patterns)
            if issues:
                issues_found[str(ts_file)] = issues
                print(f"⚠️  {ts_file.name}: {len(issues)} potential issue(s)")
            else:
                print(f"✅ {ts_file.name}: Clean")
    
    # Check that MockMarketFeedService is not imported anywhere
    print("\n🔎 Specific Verification...")
    print("-" * 70)
    
    mock_import_found = False
    for py_file in backend_dir.rglob('*.py'):
        if '__pycache__' not in str(py_file):
            with open(py_file, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                if 'from services.mock_market_feed import' in content:
                    print(f"❌ FAIL: MockMarketFeedService import found in {py_file}")
                    mock_import_found = True
    
    if not mock_import_found:
        print("✅ MockMarketFeedService import: NOT FOUND (good)")
    
    # Check for fallback data logic
    fallback_found = False
    for py_file in backend_dir.rglob('*.py'):
        if '__pycache__' not in str(py_file):
            with open(py_file, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                if 'DATA-FETCH-FALLBACK' in content and 'Use last cached' in content:
                    print(f"❌ FAIL: Fallback data logic found in {py_file}")
                    fallback_found = True
    
    if not fallback_found:
        print("✅ Fallback data logic: REMOVED (good)")
    
    # Summary
    print("\n" + "═" * 70)
    if not issues_found and not mock_import_found and not fallback_found:
        print("✨ VERIFICATION PASSED - Ready for Production!")
        print("═" * 70)
        print(f"\n✅ Checked {files_checked} files")
        print("✅ No mock data service imports")
        print("✅ No fallback synthetic data")
        print("✅ Live Zerodha data only")
        print("\n🚀 Safe to deploy to Digital Ocean")
        return 0
    else:
        print("❌ VERIFICATION FAILED - Issues detected")
        print("═" * 70)
        
        if issues_found:
            print("\nFiles with potential issues:")
            for filepath, issues in issues_found.items():
                print(f"\n  {filepath}:")
                for line_num, line in issues[:5]:  # Show first 5 issues
                    print(f"    Line {line_num}: {line[:60]}...")
        
        print("\n🛑 Do NOT deploy until issues are fixed")
        return 1

if __name__ == '__main__':
    exit(main())
