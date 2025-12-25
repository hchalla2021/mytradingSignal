"""WebSocket connection manager for broadcasting market data."""
import json
from typing import Dict, Set, Any
from fastapi import WebSocket
import asyncio


class ConnectionManager:
    """Manages WebSocket connections and broadcasts."""
    
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
    
    async def connect(self, websocket: WebSocket):
        """Accept and register a new WebSocket connection."""
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)
        print(f"📱 Client connected. Total: {len(self.active_connections)}")
    
    async def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection."""
        async with self._lock:
            self.active_connections.discard(websocket)
        print(f"📴 Client disconnected. Total: {len(self.active_connections)}")
    
    async def broadcast(self, data: Dict[str, Any]):
        """Broadcast data to all connected clients."""
        if not self.active_connections:
            return
        
        message = json.dumps(data)
        disconnected = set()
        
        async with self._lock:
            for connection in self.active_connections:
                try:
                    await connection.send_text(message)
                except Exception:
                    disconnected.add(connection)
            
            # Remove disconnected clients
            self.active_connections -= disconnected
    
    async def send_personal(self, websocket: WebSocket, data: Dict[str, Any]):
        """Send data to a specific client."""
        try:
            await websocket.send_text(json.dumps(data))
        except Exception:
            await self.disconnect(websocket)
    
    @property
    def connection_count(self) -> int:
        """Get the number of active connections."""
        return len(self.active_connections)


# Global manager instance
manager = ConnectionManager()
