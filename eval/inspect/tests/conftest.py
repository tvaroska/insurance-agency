import sys
from pathlib import Path

# The harness modules sit one level up and are not a package: Inspect loads
# them by file path, adding that directory to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
