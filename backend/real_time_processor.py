from fastapi import FastAPI, WebSocket
from fastapi.responses import HTMLResponse
import redis.asyncio as redis
import asyncio
import tensorflow as tf
import numpy as np

app = FastAPI()

# Redis connection
redis_client = redis.from_url("redis://localhost:6379", decode_responses=True)

# HTML for testing WebSocket
html = """
<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Test</title>
</head>
<body>
    <h1>WebSocket Test</h1>
    <form action="" onsubmit="sendMessage(event)">
        <input type="text" id="messageText" autocomplete="off"/>
        <button>Send</button>
    </form>
    <ul id="messages">
    </ul>
    <script>
        const ws = new WebSocket("ws://localhost:8000/ws");
        ws.onmessage = function(event) {
            const messages = document.getElementById('messages');
            const message = document.createElement('li');
            const content = document.createTextNode(event.data);
            message.appendChild(content);
            messages.appendChild(message);
        };
        function sendMessage(event) {
            const input = document.getElementById("messageText");
            ws.send(input.value);
            input.value = '';
            event.preventDefault();
        }
    </script>
</body>
</html>
"""

@app.get("/")
async def get():
    return HTMLResponse(html)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    while True:
        try:
            data = await websocket.receive_json()
            prediction = process_market_data(data)
            await redis_client.publish("market_channel", prediction)
            await websocket.send_text(f"Prediction: {prediction}")
        except Exception as e:
            print(f"WebSocket error: {e}")
            break

# Redis subscriber
async def redis_subscriber():
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("market_channel")
    async for message in pubsub.listen():
        if message["type"] == "message":
            print(f"Received message: {message['data']}")

# Background task for Redis subscription
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(redis_subscriber())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

# Load pre-trained TensorFlow model (placeholder path)
model = tf.keras.models.load_model("models/market_predictor.h5")

def process_market_data(data):
    """Process incoming market data and generate predictions."""
    try:
        # Convert data to NumPy array (example preprocessing)
        input_data = np.array(data).reshape(1, -1)
        
        # Generate prediction
        prediction = model.predict(input_data)
        
        # Interpret prediction (example logic)
        if prediction[0][0] > 0.7:
            return "Bullish"
        elif prediction[0][0] < 0.3:
            return "Bearish"
        else:
            return "Neutral"
    except Exception as e:
        print(f"Error in AI processing: {e}")
        return "Error"