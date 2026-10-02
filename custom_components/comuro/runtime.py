"""Typed runtime data for Comuro."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry

from .coordinator import ComuroCoordinator


@dataclass(slots=True)
class ComuroRuntimeData:
    """Runtime data owned by one Comuro config entry."""

    coordinator: ComuroCoordinator


ComuroConfigEntry = ConfigEntry[ComuroRuntimeData]
