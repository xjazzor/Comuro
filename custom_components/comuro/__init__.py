"""Comuro Home Assistant integration."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from .const import DOMAIN

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant

    from .runtime import ComuroRuntimeData

PLATFORMS: tuple[str, ...] = (
    "binary_sensor",
    "sensor",
)

PANEL_URL = "comuro"
PANEL_STATIC_PATH = "/comuro_static"
PANEL_JS = f"{PANEL_STATIC_PATH}/panel.js?v=0.2.2"


async def async_setup(
    hass: HomeAssistant,
    config: dict,
) -> bool:
    """Set up global Comuro HTTP and frontend resources."""
    from homeassistant.components.http import StaticPathConfig

    from .api import async_setup_views

    await async_setup_views(hass)

    frontend_dir = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                PANEL_STATIC_PATH,
                str(frontend_dir),
                False,
            )
        ]
    )
    return True


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry[ComuroRuntimeData],
) -> bool:
    """Set up Comuro from a config entry."""
    from homeassistant.components import frontend

    from .coordinator import ComuroCoordinator
    from .route_store import RouteStore
    from .runtime import ComuroRuntimeData

    route_store = RouteStore(hass)
    await route_store.async_load()

    coordinator = ComuroCoordinator(
        hass,
        route_store,
    )

    # Fail setup when Dortmund is unreachable.
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = ComuroRuntimeData(
        coordinator=coordinator,
        route_store=route_store,
    )

    if not frontend.async_panel_exists(hass, PANEL_URL):
        frontend.async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title="Comuro",
            sidebar_icon="mdi:map-marker-path",
            frontend_url_path=PANEL_URL,
            config={
                "_panel_custom": {
                    "name": "comuro-panel",
                    "embed_iframe": False,
                    "trust_external": False,
                    "js_url": PANEL_JS,
                }
            },
            require_admin=True,
        )
        entry.async_on_unload(
            lambda: frontend.async_remove_panel(
                hass,
                PANEL_URL,
                warn_if_unknown=False,
            )
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
