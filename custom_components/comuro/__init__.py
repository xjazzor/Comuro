"""Comuro Home Assistant integration."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from .const import DOMAIN, INTEGRATION_VERSION

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
PANEL_JS = f"{PANEL_STATIC_PATH}/panel.js?v={INTEGRATION_VERSION}"
ROUTE_CARD_JS = f"{PANEL_STATIC_PATH}/route-card.js?v={INTEGRATION_VERSION}"


async def async_setup(
    hass: HomeAssistant,
    config: dict,
) -> bool:
    """Set up global Comuro frontend resources."""
    from homeassistant.components import frontend, panel_custom
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

    frontend.add_extra_js_url(hass, ROUTE_CARD_JS)

    if not frontend.async_panel_exists(hass, PANEL_URL):
        await panel_custom.async_register_panel(
            hass=hass,
            webcomponent_name="comuro-panel",
            frontend_url_path=PANEL_URL,
            module_url=PANEL_JS,
            sidebar_title="Comuro",
            sidebar_icon="mdi:map-marker-path",
            embed_iframe=False,
            require_admin=True,
        )

    return True


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry[ComuroRuntimeData],
) -> bool:
    """Set up Comuro from a config entry."""
    from .coordinator import ComuroCoordinator
    from .route_store import RouteStore
    from .runtime import ComuroRuntimeData

    route_store = RouteStore(hass)
    await route_store.async_load()

    coordinator = ComuroCoordinator(
        hass,
        route_store,
        config_entry=entry,
    )

    entry.runtime_data = ComuroRuntimeData(
        coordinator=coordinator,
        route_store=route_store,
    )

    # Initialize persistent lifecycle state before the first refresh. The
    # regular async_refresh path deliberately does not call a coordinator
    # setup hook.
    await coordinator.async_initialize()

    # Fetch once before platforms subscribe. This avoids a startup race where
    # the first successful coordinator update could happen before route
    # entities have registered their listeners.
    #
    # A temporary provider failure does not abort setup; entities subscribe to
    # the coordinator afterward and retries continue in the background.
    await coordinator.async_refresh()

    # Forward platforms only after the initial refresh so newly created
    # CoordinatorEntity instances can immediately use coordinator.data.
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
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


__all__ = ["DOMAIN", "PLATFORMS"]
