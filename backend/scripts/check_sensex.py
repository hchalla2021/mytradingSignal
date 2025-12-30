from kiteconnect import KiteConnect
import os
from dotenv import load_dotenv

load_dotenv()

kite = KiteConnect(api_key=os.getenv('ZERODHA_API_KEY'))
kite.set_access_token(os.getenv('ZERODHA_ACCESS_TOKEN'))

print("\n🔍 Checking SENSEX Futures Contracts on BFO...\n")

# Get BFO instruments
insts = kite.instruments('BFO')
sensex_futs = [i for i in insts if i['name'] == 'SENSEX' and 'FUT' in i['tradingsymbol']]

print(f"Found {len(sensex_futs)} SENSEX futures contracts:\n")
for i in sensex_futs[:5]:
    print(f"  {i['tradingsymbol']:<20} Token: {i['instrument_token']}")

# Test the configured token
configured_token = int(os.getenv('SENSEX_FUT_TOKEN', 0))
print(f"\n✅ Configured token: {configured_token}")

# Find which contract this is
matching = [i for i in sensex_futs if i['instrument_token'] == configured_token]
if matching:
    print(f"   Symbol: {matching[0]['tradingsymbol']}")
    
    # Test quote
    quote_key = f"BFO:{matching[0]['tradingsymbol']}"
    result = kite.quote([quote_key])
    quote = result.get(quote_key, {})
    volume = quote.get('volume', 0)
    print(f"   Volume: {volume:,}")
else:
    print("   ⚠️ Token not found in BFO instruments!")
