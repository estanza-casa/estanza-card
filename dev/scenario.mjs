import {
  alarmHelper,
  alertHelper,
  doorHelper,
  heaterHelper,
  roomHelpers,
  windowHelper,
} from './entities.mjs';
import { callService, readToken, request, sleep } from './ha-client.mjs';
import { deleteEntity, renameEntity } from './renames.mjs';
import {
  alarmEntity,
  alertSensors,
  describeHome,
  doorEntity,
  lightEntity,
  loadDemoHome,
  thermostatEntity,
  thermostatRoom,
  windowEntity,
} from './home.mjs';

const [command = '', subject, extra] = process.argv.slice(2);
const stepMs = Number(/^\d+$/.test(command) ? command : 1500);
const token = readToken();
const model = describeHome(loadDemoHome());
const frontDoor = doorEntity('d1');
const garageDoor = doorEntity('d7');
const eveningOrder = [
  'hall',
  'living-room',
  'kitchen',
  'study',
  'landing',
  'bedroom',
  'suite',
];
const livingTemperature = roomHelpers(thermostatRoom).temperature;

async function step(label, action) {
  await action();
  console.log(`${new Date().toISOString().slice(11, 19)}  ${label}`);
  await sleep(stepMs);
}

async function state(entityId) {
  return request(`/api/states/${entityId}`, { token });
}

function sun(position) {
  return request('/api/states/sun.sun', {
    method: 'POST',
    token,
    body: { state: position, attributes: { friendly_name: 'Sun' } },
  });
}

const alarmStates = ['disarmed', 'armed_home', 'armed_away', 'triggered'];

if (command === 'alert') await raise(subject, true);
else if (command === 'clear') await clearAlerts(subject ?? 'all');
else if (command === 'alarm') await alarm(subject ?? 'triggered');
else if (command === 'rename') await rename(subject, extra);
else if (command === 'delete') await remove(subject);
else if (command === 'door-left-open') {
  await leftOpen(doorEntity(subject ?? 'd1'), doorHelper(subject ?? 'd1'));
} else if (command === 'window-left-open') {
  await leftOpen(
    windowEntity(subject ?? 'win1'),
    windowHelper(subject ?? 'win1'),
  );
} else if (command === '' || /^\d+$/.test(command)) await evening();
else {
  console.error(
    [
      'Usage: node dev/scenario.mjs [step ms]',
      `       node dev/scenario.mjs alert <${alertSensors.map((sensor) => sensor.kind).join('|')}>`,
      '       node dev/scenario.mjs clear <kind|alarm|all>',
      `       node dev/scenario.mjs alarm <${alarmStates.join('|')}>`,
      '       node dev/scenario.mjs door-left-open [door id] [minutes ago]',
      '       node dev/scenario.mjs window-left-open [window id] [minutes ago]',
      '       node dev/scenario.mjs rename <entity_id> <new_entity_id>',
      '       node dev/scenario.mjs delete <entity_id>',
    ].join('\n'),
  );
  process.exit(1);
}

function sensorOf(kind) {
  const sensor = alertSensors.find((entry) => entry.kind === kind);

  if (!sensor) {
    console.error(
      `No alert sensor for ${kind}; try ${alertSensors.map((entry) => entry.kind).join(', ')}`,
    );
    process.exit(1);
  }

  return sensor;
}

async function raise(kind, on) {
  const sensor = sensorOf(kind);

  await callService(token, 'input_boolean', on ? 'turn_on' : 'turn_off', {
    entity_id: alertHelper(sensor),
  });
  console.log(`${kind} in ${sensor.room} ${on ? 'raised' : 'cleared'}`);
}

async function clearAlerts(kind) {
  if (kind === 'alarm') return alarm('disarmed');
  if (kind !== 'all') return raise(kind, false);

  await callService(token, 'input_boolean', 'turn_off', {
    entity_id: alertSensors.map(alertHelper),
  });
  await alarm('disarmed');
  console.log('Every alert cleared');
}

async function alarm(state) {
  if (!alarmStates.includes(state)) {
    console.error(`The alarm takes one of ${alarmStates.join(', ')}`);
    process.exit(1);
  }

  await callService(token, 'input_select', 'select_option', {
    entity_id: alarmHelper(),
    option: state,
  });
  console.log(`${alarmEntity} is ${state}`);
}

async function leftOpen(entityId, helper) {
  const minutes = Number(extra ?? 12);

  await callService(token, 'input_boolean', 'turn_on', { entity_id: helper });
  await sleep(300);
  await callService(token, 'estanza_dev', 'backdate', {
    entity_id: entityId,
    minutes,
  });

  const opened = await state(entityId);

  console.log(`${entityId} ${opened.state} since ${opened.last_changed}`);
}

async function rename(entityId, newEntityId) {
  if (!entityId || !newEntityId) {
    console.error('Rename takes an entity id and its new entity id');
    process.exit(1);
  }

  const entry = await renameEntity(token, entityId, newEntityId);

  console.log(`${entityId} is now ${entry.entity_id}, registry id ${entry.id}`);
}

async function remove(entityId) {
  if (!entityId) {
    console.error('Delete takes an entity id');
    process.exit(1);
  }

  await deleteEntity(token, entityId);
  console.log(`${entityId} deleted from the entity registry`);
}

async function evening() {
  await step(
    'Reset: daylight, every light off, doors shut, heating off',
    async () => {
      await sun('above_horizon');
      await callService(token, 'light', 'turn_off', {
        entity_id: model.lights.map((light) => lightEntity(light.slug)),
      });
      await callService(token, 'input_boolean', 'turn_off', {
        entity_id: 'all',
      });
      await callService(token, 'climate', 'set_hvac_mode', {
        entity_id: thermostatEntity(),
        hvac_mode: 'off',
      });
      await callService(token, 'input_number', 'set_value', {
        entity_id: livingTemperature,
        value: 18.4,
      });
      await callService(token, 'cover', 'close_cover', {
        entity_id: garageDoor,
      });
    },
  );

  await step('Sunset', () => sun('below_horizon'));

  for (const room of eveningOrder) {
    const light = model.lights.find((entry) => entry.room === room);

    await step(`Evening: ${room} light on, warm white`, () =>
      callService(token, 'light', 'turn_on', {
        entity_id: lightEntity(light.slug),
        brightness: 190,
        hs_color: [32, 45],
      }),
    );
  }

  await step('Kitchen light to a dim blue for dinner', () =>
    callService(token, 'light', 'turn_on', {
      entity_id: lightEntity('kitchen-light'),
      brightness: 90,
      hs_color: [220, 70],
    }),
  );

  await step('Front door opens', () =>
    callService(token, 'input_boolean', 'turn_on', {
      entity_id: 'input_boolean.door_d1_open',
    }),
  );
  console.log(`          ${frontDoor} is ${(await state(frontDoor)).state}`);

  await step('Front door closes', () =>
    callService(token, 'input_boolean', 'turn_off', {
      entity_id: 'input_boolean.door_d1_open',
    }),
  );
  console.log(`          ${frontDoor} is ${(await state(frontDoor)).state}`);

  await step('Garage door half open', () =>
    callService(token, 'cover', 'set_cover_position', {
      entity_id: garageDoor,
      position: 50,
    }),
  );

  await step('Heating on: living room thermostat to 21.5 C', () =>
    callService(token, 'climate', 'set_temperature', {
      entity_id: thermostatEntity(),
      hvac_mode: 'heat',
      temperature: 21.5,
    }),
  );

  const climate = await state(thermostatEntity());
  const heater = await state(heaterHelper());
  console.log(
    `          ${thermostatEntity()} ${climate.state}, action ${climate.attributes.hvac_action}, heater ${heater.state}`,
  );

  for (const temperature of [19.2, 20.1, 21.0, 21.9]) {
    await step(`Living room warms to ${temperature} C`, () =>
      callService(token, 'input_number', 'set_value', {
        entity_id: livingTemperature,
        value: temperature,
      }),
    );
  }

  const warmed = await state(thermostatEntity());
  console.log(
    `          ${thermostatEntity()} action ${warmed.attributes.hvac_action}`,
  );

  await step('Garage door closes', () =>
    callService(token, 'cover', 'close_cover', { entity_id: garageDoor }),
  );

  for (const room of [...eveningOrder].reverse()) {
    const light = model.lights.find((entry) => entry.room === room);

    await step(`Bedtime: ${room} light off`, () =>
      callService(token, 'light', 'turn_off', {
        entity_id: lightEntity(light.slug),
      }),
    );
  }

  console.log('Scenario finished');
}
