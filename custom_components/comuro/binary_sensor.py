"""Comuro binary sensor platform."""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import ComuroCoordinator
from .entity import ComuroRouteEntity
from .runtime import ComuroConfigEntry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Comuro binary sensors."""
    data: ComuroConfigEntry = entry  # type: ignore[assignment]
    coordinator = data.runtime_data.coordinator

    known_routes: set[str] = set()

    def add_new_routes() -> None:
        new_ids = set(coordinator.data) - known_routes

        if not new_ids:
            return

        async_add_entities(
            [
                ComuroRouteAffectedBinarySensor(
                    coordinator,
                    route_id,
                )
                for route_id in new_ids
            ]
        )

        known_routes.update(new_ids)

    add_new_routes()

    coordinator.async_add_listener(
        add_new_routes
    )


class ComuroRouteAffectedBinarySensor(
    ComuroRouteEntity,
    BinarySensorEntity,
):
    """Indicate whether a route currently has affected roadworks."""

    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(
        self,
        coordinator: ComuroCoordinator,
        route_id: str,
    ) -> None:
        super().__init__(
            coordinator,
            route_id,
        )

        self._attr_unique_id = (
            f"{route_id}_affected"
        )
        self._attr_name = "Betroffen"

        self._attr_icon = "mdi:road-variant"

    @property
    def is_on(self) -> bool:
        """Return whether current roadworks affect the route."""
        state = self.route_state()

        return bool(
            state and state.current_matches
        )

    @property
    def extra_state_attributes(self) -> dict:
        """Return all route matches and lifecycle information."""
        state = self.route_state()

        if state is None:
            return {
                "route_id": self.route_id,
                "matches": [],
            }

        return {
            "route_id": self.route_id,
            "route_name": state.route.name,
            "buffer_m": state.route.buffer_m,
            "current_count": len(
                state.current_matches
            ),
            "planned_count": len(
                state.planned_matches
            ),
            "matches": self.match_attributes(),
        }
