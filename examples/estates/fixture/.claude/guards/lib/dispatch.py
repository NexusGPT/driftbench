#!/usr/bin/env python3
"""Runs the guard script named as its first argument, from the guards folder, with the event on stdin."""
import os
import subprocess
import sys

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
target = os.path.join(here, sys.argv[1])
sys.exit(subprocess.run([sys.executable, target], stdin=sys.stdin).returncode)
