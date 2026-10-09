"""Typed runtime data for Comuro."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry

from .coordinator import ComuroCoordinator
from .route_store import RouteStore


@dataclass(slots=True)
class ComuroRuntimeData:
    """Runtime data owned by one Comuro config entry."""

    coordinator: ComuroCoordinator
    route_store: RouteStore


ComuroConfigEntry = ConfigEntry[ComuroRuntimeData]
