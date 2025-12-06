#!/bin/bash
set -e

echo "Installing Python dependencies..."
cd backend

# Upgrade pip and install build tools
pip install --upgrade pip setuptools wheel

# Install packages that need compilation first with specific flags
pip install --no-cache-dir numpy==1.26.4 scipy==1.11.4

# Install remaining packages
pip install --no-cache-dir -r requirements.txt

echo "Build completed successfully!"
