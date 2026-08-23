#!/bin/bash
cd /home/knklinux/knk-suite
fuser -k 8086/tcp 2>/dev/null
sleep 1
exec node backend/index.js