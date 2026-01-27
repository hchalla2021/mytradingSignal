#!/usr/bin/env python3
"""
Generate Test Market Data
Use this script to create realistic test data for development/testing
Instead of hardcoding test data in code, generate it dynamically

Usage:
    python generate_test_data.py --output test_data.json --count 100

"""

import json
import argparse
from datetime import datetime, timedelta
from data.test_data_factory import TestDataFactory, TestDataConfig
import os

def generate_test_data(
    output_file: str = "test_market_data.json",
    count: int = 1,
    include_analysis: bool = True,
    price_variance: float = 0.02,
) -> None:
    """
    Generate test market data
    
    Args:
        output_file: Output JSON file path
        count: Number of iterations to generate
        include_analysis: Whether to include analysis data
        price_variance: Price variance percentage
    """
    print("\n" + "="*80)
    print("🧪 GENERATING TEST MARKET DATA")
    print("="*80 + "\n")
    
    config = TestDataConfig.load_from_env()
    print(f"📋 Configuration:")
    print(f"   Output: {output_file}")
    print(f"   Iterations: {count}")
    print(f"   Include Analysis: {include_analysis}")
    print(f"   Price Variance: {price_variance*100:.2f}%\n")
    
    # Generate test data
    test_data = {}
    
    for iteration in range(count):
        timestamp = (datetime.now() - timedelta(seconds=iteration*5)).isoformat()
        
        if iteration == 0:
            print(f"📊 Generating {len(TestDataFactory.BASE_PRICES)} symbols...\n")
        
        for symbol in TestDataFactory.BASE_PRICES.keys():
            # Generate tick
            tick = TestDataFactory.generate_tick(
                symbol,
                price_variance=price_variance
            )
            tick["timestamp"] = timestamp
            
            # Add analysis if requested
            if include_analysis:
                analysis = TestDataFactory.generate_analysis(tick)
                tick["analysis"] = analysis
            
            # Store (last generated data overwrites)
            test_data[symbol] = tick
            
            if iteration == 0:
                status = tick.get("status", "UNKNOWN")
                print(f"✅ {symbol}:")
                print(f"   Price: ₹{tick['price']:,.2f}")
                print(f"   Change: {tick['changePercent']:+.2f}%")
                print(f"   Volume: {tick['volume']:,}")
                if include_analysis:
                    print(f"   Signal: {tick['analysis']['signal']}")
                print()
    
    # Save to file
    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    with open(output_file, 'w') as f:
        json.dump(test_data, f, indent=2)
    
    print(f"✅ Test data generated and saved to: {os.path.abspath(output_file)}")
    print(f"\n📈 Summary:")
    print(f"   Symbols: {len(test_data)}")
    print(f"   Timestamp: {test_data.get(list(test_data.keys())[0], {}).get('timestamp', 'N/A')}")
    print(f"   File Size: {os.path.getsize(output_file) / 1024:.2f} KB\n")


def generate_multiple_snapshots(
    output_dir: str = "test_data_snapshots",
    count: int = 10,
    interval_seconds: int = 5,
) -> None:
    """
    Generate multiple snapshots of market data (simulating live data)
    
    Args:
        output_dir: Directory to store snapshots
        count: Number of snapshots
        interval_seconds: Time between snapshots
    """
    print("\n" + "="*80)
    print("📺 GENERATING MULTIPLE DATA SNAPSHOTS (LIVE SIMULATION)")
    print("="*80 + "\n")
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    print(f"📋 Configuration:")
    print(f"   Output Dir: {output_dir}")
    print(f"   Snapshots: {count}")
    print(f"   Interval: {interval_seconds}s\n")
    
    snapshots = []
    
    for i in range(count):
        timestamp = datetime.now() - timedelta(seconds=(count-i)*interval_seconds)
        
        print(f"📊 Snapshot {i+1}/{count}: {timestamp.strftime('%H:%M:%S')}")
        
        snapshot = {}
        for symbol in TestDataFactory.BASE_PRICES.keys():
            tick = TestDataFactory.generate_complete_tick_with_analysis(symbol)
            tick["timestamp"] = timestamp.isoformat()
            snapshot[symbol] = tick
        
        snapshots.append({
            "timestamp": timestamp.isoformat(),
            "data": snapshot
        })
        
        # Save individual snapshot
        snapshot_file = os.path.join(
            output_dir,
            f"snapshot_{i:03d}_{timestamp.strftime('%H%M%S')}.json"
        )
        with open(snapshot_file, 'w') as f:
            json.dump(snapshot, f, indent=2)
    
    # Save all snapshots
    all_snapshots_file = os.path.join(output_dir, "all_snapshots.jsonl")
    with open(all_snapshots_file, 'w') as f:
        for snapshot in snapshots:
            f.write(json.dumps(snapshot) + "\n")
    
    print(f"\n✅ Generated {count} snapshots in: {os.path.abspath(output_dir)}")
    print(f"   Individual files: snapshot_*.json")
    print(f"   Combined file: all_snapshots.jsonl\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate test market data for development/testing"
    )
    parser.add_argument(
        "--output",
        default="test_market_data.json",
        help="Output file for test data (default: test_market_data.json)"
    )
    parser.add_argument(
        "--count",
        type=int,
        default=1,
        help="Number of iterations to generate (default: 1)"
    )
    parser.add_argument(
        "--no-analysis",
        action="store_true",
        help="Don't include analysis data"
    )
    parser.add_argument(
        "--variance",
        type=float,
        default=0.02,
        help="Price variance percentage (default: 0.02 = 2%%)"
    )
    parser.add_argument(
        "--snapshots",
        type=int,
        default=None,
        help="Generate multiple snapshots (live simulation)"
    )
    parser.add_argument(
        "--snapshot-dir",
        default="test_data_snapshots",
        help="Directory for snapshots (default: test_data_snapshots)"
    )
    
    args = parser.parse_args()
    
    if args.snapshots:
        # Generate snapshots
        generate_multiple_snapshots(
            output_dir=args.snapshot_dir,
            count=args.snapshots
        )
    else:
        # Generate single data file
        generate_test_data(
            output_file=args.output,
            count=args.count,
            include_analysis=not args.no_analysis,
            price_variance=args.variance
        )
