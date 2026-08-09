import time

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
import homeassistant.helpers.config_validation as cv

DOMAIN = "estanza_dev"

BACKDATE_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("minutes"): vol.Coerce(float),
    }
)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    async def backdate(call: ServiceCall) -> None:
        entity_id = call.data["entity_id"]
        current = hass.states.get(entity_id)

        if current is None:
            return

        hass.states.async_set(
            entity_id,
            current.state,
            current.attributes,
            force_update=True,
            timestamp=time.time() - call.data["minutes"] * 60,
        )

    hass.services.async_register(DOMAIN, "backdate", backdate, BACKDATE_SCHEMA)

    return True
