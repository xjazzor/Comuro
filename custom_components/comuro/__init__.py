"""Comuro Home Assistant integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .coordinator import ComuroCoordinator
from .runtime import ComuroRuntimeData

PLATFORMS: tuple[str, ...] = (
    "binary_sensor",
    "sensor",
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry[ComuroRuntimeData],
) -> bool:
    """Set up Comuro from a config entry."""
    coordinator = ComuroCoordinator(hass)

    # Fail setup when the Dortmund data source is not reachable.
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = ComuroRuntimeData(
        coordinator=coordinator,
    )

    await hass.config_entries.async_forward_entry_setups(
        entry,
        PLATFORMS,
    )

    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: ConfigEntry[ComuroRuntimeData],
) -> bool:
    """Unload Comuro."""
    return await hass.config_entries.async_unload_platforms(
        entry,
        PLATFORMS,
    )
