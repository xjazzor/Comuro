"""Config flow for Comuro."""

from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN
from .dortmund import DortmundProvider


class ComuroConfigFlow(
    config_entries.ConfigFlow,
    domain=DOMAIN,
):
    """Handle Comuro configuration."""

    VERSION = 1

    async def async_step_user(
        self,
        user_input: dict | None = None,
    ) -> FlowResult:
        """Install Comuro after testing the data source."""
        if user_input is not None:
            self._abort_if_unique_id_configured()

            try:
                await self.hass.async_add_executor_job(
                    DortmundProvider().fetch_snapshot
                )
            except Exception:  # noqa: BLE001
                return self.async_show_form(
                    step_id="user",
                    data_schema=vol.Schema({}),
                    errors={
                        "base": "cannot_connect",
                    },
                )

            return self.async_create_entry(
                title="Comuro",
                data={},
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
        )
