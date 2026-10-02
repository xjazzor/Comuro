"""Comuro binary sensor platform."""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
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

    known_routes: set[str] = set(coordinator.data)

    @callback
    def sync_routes() -> None:
        current_ids = set(coordinator.data)
        known_routes.intersection_update(current_ids)
        new_ids = current_ids - known_routes

        if new_ids:
            new_entities: list[ComuroRouteAffectedBinarySensor] = [
                ComuroRouteAffectedBinarySensor(
                    coordinator,
                    route_id,
                )
                for route_id in new_ids
            ]
            async_add_entities(new_entities)
            known_routes.update(new_ids)

    sync_routes()
    unsubscribe = coordinator.async_add_listener(sync_routes)
    entry.async_on_unload(unsubscribe)


class ComuroRouteAffectedBinarySensor(
    ComuroRouteEntity,
    BinarySensorEntity,
):
    """Indicate whether current roadworks affect the route."""

    _attr_device_class = (
        BinarySensorDeviceClass.PROBLEM
    )

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
        """Return route matches and route configuration."""
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
