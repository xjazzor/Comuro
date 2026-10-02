"""Constants for Comuro."""

from datetime import timedelta
from pathlib import Path
from typing import Final

DOMAIN: Final = "comuro"
INTEGRATION_VERSION: Final = "0.1.7"

UPDATE_INTERVAL: Final = timedelta(hours=1)

ROUTES_FILE: Final = Path("/share/comuro/routes.json")

TRACKER_STORE_VERSION: Final = 1
TRACKER_STORE_KEY: Final = f"{DOMAIN}.tracker"
MISSING_CYCLES_BEFORE_RESOLVED: Final = 2
