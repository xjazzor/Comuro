"""Common entity helpers for Comuro."""

from __future__ import annotations

import asyncio
import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import ComuroCoordinator, RouteState

_LOGGER = logging.getLogger(__name__)


class ComuroRouteEntity(
    CoordinatorEntity[ComuroCoordinator]
):
    """Base class for entities belonging to one route."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: ComuroCoordinator,
        route_id: str,
    ) -> None:
        super().__init__(coordinator)

        self.route_id = route_id

        self._attr_device_info = {
            "identifiers": {
                (DOMAIN, route_id),
            },
            "name": self._route_name(),
            "manufacturer": "Comuro",
            "model": "Route",
        }

    def route_state(self) -> RouteState | None:
        """Return the current state for this route."""
        return self.coordinator.data.get(
            self.route_id
        )

    @property
    def available(self) -> bool:
        """Return whether the configured route is currently available."""
        return self.route_state() is not None

    def _route_name(self) -> str:
        state = self.coordinator.data.get(
            self.route_id
        )
        if state:
            return state.route.name

        return self.route_id

    def match_attributes(self) -> list[dict]:
        """Return compact route match data for HA state attributes."""
        state = self.route_state()

        if state is None:
            return []

        return [
            {
                "construction_id": match.construction_id,
                "status": match.status,
                "name": match.construction.name,
                "route_position_m": match.route_position_m,
                "distance_m": match.distance_m,
                "start": (
                    match.construction.start.isoformat()
                    if match.construction.start
                    else None
                ),
                "end": (
                    match.construction.end.isoformat()
                    if match.construction.end
                    else None
                ),
            }
            for match in state.matches
        ]


async def async_remove_route_device_if_empty(
    hass: HomeAssistant,
    route_id: str,
) -> None:
    """Remove the route device when no registry entities remain."""
    device_registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)

    # Entity removal is initiated independently by the sensor and binary
    # sensor platforms. Give both platforms time to finish before deciding
    # whether the shared route device is orphaned.
    for attempt in range(5):
        device = next(
            (
                device
                for device in device_registry.async_get_devices()
                if (DOMAIN, route_id) in device.identifiers
            ),
            None,
        )

        if device is None:
            return

        entries = er.async_entries_for_device(
            entity_registry,
            device.id,
            include_disabled_entities=True,
        )

        if not entries:
            _LOGGER.info(
                "Removing orphaned Comuro route device: %s",
                route_id,
            )
            device_registry.async_remove_device(device.id)
            return

        if attempt < 4:
            await asyncio.sleep(0.2)

    _LOGGER.warning(
        "Comuro route device %s still has %d registry entities after "
        "route removal; device was not removed",
        route_id,
        len(entries),
    )
