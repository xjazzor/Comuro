"""Constants for Comuro."""

from datetime import timedelta
from typing import Final

DOMAIN: Final = "comuro"
INTEGRATION_VERSION: Final = "0.2.5"

UPDATE_INTERVAL: Final = timedelta(hours=1)

TRACKER_STORE_VERSION: Final = 1
TRACKER_STORE_KEY: Final = f"{DOMAIN}.tracker"
MISSING_CYCLES_BEFORE_RESOLVED: Final = 2
