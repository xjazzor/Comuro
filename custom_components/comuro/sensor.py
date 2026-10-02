"""Comuro sensor platform."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.sensor import (
    SensorEntity,
    SensorStateClass,
)

from .coordinator import ComuroCoordinator
from .entity import ComuroRouteEntity
from .runtime import ComuroConfigEntry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Comuro sensors."""
    data: ComuroConfigEntry = entry  # type: ignore[assignment]
    coordinator = data.runtime_data.coordinator

    known_routes: set[str] = set(coordinator.data)

    @callback
    def sync_routes() -> None:
        current_ids = set(coordinator.data)
        known_routes.intersection_update(current_ids)
        new_ids = current_ids - known_routes

        if new_ids:
            new_entities: list[ComuroRouteCountSensor] = []

            for route_id in new_ids:
                new_entities.extend(
                    (
                        ComuroRouteCountSensor(
                            coordinator,
                            route_id,
                            "aktuell",
                        ),
                        ComuroRouteCountSensor(
                            coordinator,
                            route_id,
                            "geplant",
                        ),
                    )
                )

            async_add_entities(new_entities)
            known_routes.update(new_ids)

    sync_routes()
    unsubscribe = coordinator.async_add_listener(sync_routes)
    entry.async_on_unload(unsubscribe)


class ComuroRouteCountSensor(
    ComuroRouteEntity,
    SensorEntity,
):
    """Number of current or planned roadworks for a route."""

    def __init__(
        self,
        coordinator: ComuroCoordinator,
        route_id: str,
        status: str,
    ) -> None:
        super().__init__(
            coordinator,
            route_id,
        )

        self.status_filter = status

        self._attr_unique_id = (
            f"{route_id}_construction_count_{status}"
        )
        self._attr_name = (
            "Aktuelle Baustellen"
            if status == "aktuell"
            else "Geplante Baustellen"
        )
        self._attr_icon = "mdi:road-variant"
        self._attr_state_class = (
            SensorStateClass.MEASUREMENT
        )

    @property
    def native_value(self) -> int:
        """Return the construction count."""
        state = self.route_state()
        if state is None:
            return 0

        if self.status_filter == "aktuell":
            return len(state.current_matches)

        return len(state.planned_matches)

    @property
    def extra_state_attributes(self) -> dict:
        """Return route match details."""
        state = self.route_state()

        return {
            "route_id": self.route_id,
            "buffer_m": (
                state.route.buffer_m
                if state
                else None
            ),
            "matches": self.match_attributes(),
        }
