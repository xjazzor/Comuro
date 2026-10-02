"""Comuro Home Assistant integration."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant

    from .runtime import ComuroRuntimeData

from .const import DOMAIN

PLATFORMS: tuple[str, ...] = (
    "binary_sensor",
    "sensor",
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry[ComuroRuntimeData],
) -> bool:
    """Set up Comuro from a config entry."""
    from .coordinator import ComuroCoordinator
    from .runtime import ComuroRuntimeData

    coordinator = ComuroCoordinator(hass)

    # Fail setup when Dortmund is unreachable.
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = ComuroRuntimeData(
        coordinator=coordinator,
    )

    entry.async_on_unload(
        coordinator.async_start_route_watcher()
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


__all__ = ["DOMAIN", "PLATFORMS"]
