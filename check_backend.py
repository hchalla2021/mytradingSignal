#!/usr/bin/env python
import socket

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
result = sock.connect_ex(('127.0.0.1', 8000))
if result == 0:
    print("Backend is RUNNING on port 8000")
else:
    print("Backend NOT accessible on port 8000")
sock.close()
