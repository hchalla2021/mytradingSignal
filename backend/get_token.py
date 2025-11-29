from kiteconnect import KiteConnect

api_key = "g5tyrnn1mlckrb6f"
api_secret = "9qlzwmum5f7pami0gacyxc7uxa6w823s"
request_token = "3OfhUcwfSJcsLgQ7uMw6aLZ9ZIKTx7gP"

kite = KiteConnect(api_key=api_key)
data = kite.generate_session(request_token, api_secret=api_secret)

print(f"Access Token: {data['access_token']}")
print(f"\nUpdate your .env file with:")
print(f"ZERODHA_ACCESS_TOKEN={data['access_token']}")
