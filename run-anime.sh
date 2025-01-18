#!/bin/bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm

# Connect to NordVPN
# nordvpn connect

# Change to your project directory
cd /data/Projects/nyaa-downloader

# Run your npm command
npm run downloader

# Disconnect from NordVPN after npm command completes
# nordvpn disconnect
