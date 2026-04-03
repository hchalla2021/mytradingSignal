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
        """Broadcast data to all connected clients.
        
        Snapshots the connection set under the lock, then sends
        outside the lock so one slow client cannot block others.
        """
        if not self.active_connections:
            return
        
        message = json.dumps(data)
        
        # Snapshot connections under lock (fast)
        async with self._lock:
            connections = list(self.active_connections)
        
        # Send to all clients concurrently (outside lock)
        async def _send(conn: WebSocket):
            try:
                await asyncio.wait_for(conn.send_text(message), timeout=5.0)
                return None
            except Exception:
                return conn
        
        results = await asyncio.gather(*[_send(c) for c in connections], return_exceptions=True)
        
        # Collect disconnected clients
        disconnected = {r for r in results if isinstance(r, WebSocket)}
        
        if disconnected:
            async with self._lock:
                self.active_connections -= disconnected
    
    async def send_personal(self, websocket: WebSocket, data: Dict[str, Any]):
        """Send data to a specific client."""
        try:
            await websocket.send_text(json.dumps(data))
        except Exception:
            await self.disconnect(websocket)
    
    async def broadcast_ai_update(self, symbol: str, analysis: Dict[str, Any]):
        """Broadcast AI analysis update to all clients."""
        message = {
            "type": "ai_update",
            "symbol": symbol,
            "data": analysis,
            "timestamp": analysis.get('meta', {}).get('timestamp')
        }
        await self.broadcast(message)
    
    async def broadcast_auth_status(self, status: str, message: str, requires_action: bool = False):
        """Broadcast authentication status to all clients.
        
        Args:
            status: Status code (TOKEN_VALID, TOKEN_EXPIRED, TOKEN_WARNING, LOGIN_REQUIRED)
            message: Human-readable message
            requires_action: Whether user action is required
        """
        notification = {
            "type": "auth_status",
            "status": status,
            "message": message,
            "requires_action": requires_action,
            "timestamp": None  # Will be set by frontend
        }
        await self.broadcast(notification)
        print(f"📢 Broadcasted auth status: {status} - {message}")
    
    @property
    def connection_count(self) -> int:
        """Get the number of active connections."""
        return len(self.active_connections)


# Global manager instance
manager = ConnectionManager()
