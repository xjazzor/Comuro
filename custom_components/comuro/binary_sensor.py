"""Comuro binary sensor platform."""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_component
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
    entities_by_route: dict[
        str,
        ComuroRouteAffectedBinarySensor,
    ] = {}

    async def remove_entities(
        entities: list[ComuroRouteAffectedBinarySensor],
    ) -> None:
        """Remove route entities from Home Assistant."""
        for entity in entities:
            if entity.entity_id:
                await entity_component.async_remove_entity(
                    hass,
                    entity.entity_id,
                )

    @callback
    def sync_routes() -> None:
        current_ids = set(coordinator.data)
        removed_ids = known_routes - current_ids
        new_ids = current_ids - known_routes

        removed_entities = [
            entities_by_route.pop(route_id)
            for route_id in removed_ids
            if route_id in entities_by_route
        ]

        if removed_entities:
            hass.async_create_task(
                remove_entities(removed_entities)
            )

        if new_ids:
            new_entities: list[ComuroRouteAffectedBinarySensor] = []

            for route_id in new_ids:
                entity = ComuroRouteAffectedBinarySensor(
                    coordinator,
                    route_id,
                )
                entities_by_route[route_id] = entity
                new_entities.append(entity)

            async_add_entities(new_entities)

        known_routes.intersection_update(current_ids)
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
