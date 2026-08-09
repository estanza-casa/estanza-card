import {
  alarmEntity,
  alertEntity,
  alertSensors,
  coverDoorIds,
  doorEntity,
  exteriorDoorNames,
  humidityEntity,
  lightEntity,
  lockEntity,
  objectId,
  occupancyEntity,
  plugEntity,
  temperatureEntity,
  thermostatEntity,
  thermostatRoom,
  windowEntity,
} from './home.mjs';

const uniquePrefix = 'estanza_dev';

export function buildPackage(model) {
  const labels = roomLabels(model);
  const pkg = {
    input_boolean: {},
    input_number: {},
    input_select: {},
    template: [
      {
        light: [],
        sensor: [],
        binary_sensor: [],
        cover: [],
        switch: [],
        lock: [],
        alarm_control_panel: [],
      },
    ],
    climate: [],
  };
  const templates = pkg.template[0];

  model.rooms.forEach((room, index) => {
    addRoomClimate(pkg, templates, room, 18.5 + (index % 4) * 0.7);
    addRoomOccupancy(pkg, templates, room);
  });

  for (const light of model.lights) addLight(pkg, templates, light, labels);

  const seen = new Map();

  for (const floor of model.floors) {
    for (const door of floor.doors) addDoor(pkg, templates, door, labels, seen);
    for (const window of floor.windows) {
      addWindow(pkg, templates, window, labels, seen);
    }
  }

  for (const sensor of alertSensors)
    addAlertSensor(pkg, templates, sensor, labels);

  addThermostat(pkg, labels);
  addLock(pkg, templates);
  addPlug(pkg, templates);
  addAlarm(pkg, templates);

  return pkg;
}

export function alertHelper(sensor) {
  return `input_boolean.${key(alertEntity(sensor))}`;
}

export function alarmHelper() {
  return `input_select.${key(alarmEntity)}`;
}

export function lockHelper() {
  return `input_boolean.${key(lockEntity())}_locked`;
}

export function plugHelper() {
  return `input_boolean.${key(plugEntity())}_on`;
}

export function entityAreas(model) {
  const areas = {};

  for (const room of model.rooms) {
    areas[temperatureEntity(room.slug)] = room.slug;
    areas[humidityEntity(room.slug)] = room.slug;
    areas[occupancyEntity(room.slug)] = room.slug;
  }

  for (const light of model.lights) areas[lightEntity(light.slug)] = light.room;

  for (const floor of model.floors) {
    for (const door of floor.doors) areas[doorEntity(door.id)] = door.rooms[0];
    for (const window of floor.windows) {
      areas[windowEntity(window.id)] = window.rooms[0];
    }
  }

  areas[thermostatEntity()] = thermostatRoom;

  for (const sensor of alertSensors) areas[alertEntity(sensor)] = sensor.room;

  return areas;
}

export function lightHelpers(slug) {
  const id = objectId(slug);

  return {
    on: `input_boolean.${id}_on`,
    brightness: `input_number.${id}_brightness`,
    hue: `input_number.${id}_hue`,
    saturation: `input_number.${id}_saturation`,
  };
}

export function doorHelper(id) {
  return coverDoorIds.includes(id)
    ? `input_number.door_${objectId(id)}_position`
    : `input_boolean.door_${objectId(id)}_open`;
}

export function windowHelper(id) {
  return `input_boolean.window_${objectId(id)}_open`;
}

export function roomHelpers(slug) {
  const id = objectId(slug);

  return {
    temperature: `input_number.${id}_temperature`,
    humidity: `input_number.${id}_humidity`,
    occupied: `input_boolean.${id}_occupied`,
  };
}

export function heaterHelper() {
  return `input_boolean.${objectId(thermostatRoom)}_heater`;
}

function addRoomClimate(pkg, templates, room, temperature) {
  const helpers = roomHelpers(room.slug);

  pkg.input_number[key(helpers.temperature)] = {
    name: `${room.label} temperature`,
    min: 5,
    max: 35,
    step: 0.1,
    initial: Math.round(temperature * 10) / 10,
    unit_of_measurement: '°C',
    mode: 'box',
  };
  pkg.input_number[key(helpers.humidity)] = {
    name: `${room.label} humidity`,
    min: 10,
    max: 95,
    step: 1,
    initial: 45,
    unit_of_measurement: '%',
    mode: 'box',
  };

  templates.sensor.push(
    sensor(temperatureEntity(room.slug), `${room.label} temperature`, {
      device_class: 'temperature',
      unit_of_measurement: '°C',
      state: `{{ states('${helpers.temperature}') | float(0) }}`,
    }),
    sensor(humidityEntity(room.slug), `${room.label} humidity`, {
      device_class: 'humidity',
      unit_of_measurement: '%',
      state: `{{ states('${helpers.humidity}') | float(0) }}`,
    }),
  );
}

function addRoomOccupancy(pkg, templates, room) {
  const helper = roomHelpers(room.slug).occupied;

  pkg.input_boolean[key(helper)] = {
    name: `${room.label} occupied`,
    initial: false,
  };
  templates.binary_sensor.push({
    name: `${room.label} occupancy`,
    unique_id: uniqueId(occupancyEntity(room.slug)),
    default_entity_id: occupancyEntity(room.slug),
    device_class: 'occupancy',
    state: `{{ is_state('${helper}', 'on') }}`,
  });
}

function addLight(pkg, templates, light, labels) {
  const helpers = lightHelpers(light.slug);
  const name = `${labels.get(light.room) ?? light.slug} light`;

  pkg.input_boolean[key(helpers.on)] = { name: `${name} on`, initial: false };
  pkg.input_number[key(helpers.brightness)] = slider(
    `${name} brightness`,
    0,
    255,
    200,
  );
  pkg.input_number[key(helpers.hue)] = slider(`${name} hue`, 0, 360, 32);
  pkg.input_number[key(helpers.saturation)] = slider(
    `${name} saturation`,
    0,
    100,
    40,
  );

  const turnOn = {
    action: 'input_boolean.turn_on',
    target: { entity_id: helpers.on },
  };
  const keepBrightness = setValue(
    helpers.brightness,
    `{{ brightness if brightness is defined else states('${helpers.brightness}') }}`,
  );

  templates.light.push({
    name,
    unique_id: uniqueId(lightEntity(light.slug)),
    default_entity_id: lightEntity(light.slug),
    state: `{{ is_state('${helpers.on}', 'on') }}`,
    level: `{{ states('${helpers.brightness}') | int(0) }}`,
    hs: `({{ states('${helpers.hue}') | float(0) }}, {{ states('${helpers.saturation}') | float(0) }})`,
    turn_on: [keepBrightness, turnOn],
    turn_off: [
      { action: 'input_boolean.turn_off', target: { entity_id: helpers.on } },
    ],
    set_level: [setValue(helpers.brightness, '{{ brightness }}'), turnOn],
    set_hs: [
      setValue(helpers.hue, '{{ h }}'),
      setValue(helpers.saturation, '{{ s }}'),
      keepBrightness,
      turnOn,
    ],
  });
}

function addDoor(pkg, templates, door, labels, seen) {
  const name =
    exteriorDoorNames[door.id] ?? openingName('door', door, labels, seen);
  const helper = doorHelper(door.id);

  if (coverDoorIds.includes(door.id)) {
    pkg.input_number[key(helper)] = {
      name: `${name} position`,
      min: 0,
      max: 100,
      step: 1,
      initial: 0,
      unit_of_measurement: '%',
      mode: 'slider',
    };
    templates.cover.push({
      name,
      unique_id: uniqueId(doorEntity(door.id)),
      default_entity_id: doorEntity(door.id),
      device_class: 'garage',
      position: `{{ states('${helper}') | int(0) }}`,
      open_cover: [setValue(helper, 100)],
      close_cover: [setValue(helper, 0)],
      set_cover_position: [setValue(helper, '{{ position }}')],
    });

    return;
  }

  pkg.input_boolean[key(helper)] = { name: `${name} open`, initial: false };
  templates.binary_sensor.push({
    name,
    unique_id: uniqueId(doorEntity(door.id)),
    default_entity_id: doorEntity(door.id),
    device_class: 'door',
    state: `{{ is_state('${helper}', 'on') }}`,
  });
}

function addWindow(pkg, templates, window, labels, seen) {
  const name = openingName('window', window, labels, seen);
  const helper = windowHelper(window.id);

  pkg.input_boolean[key(helper)] = { name: `${name} open`, initial: false };
  templates.binary_sensor.push({
    name,
    unique_id: uniqueId(windowEntity(window.id)),
    default_entity_id: windowEntity(window.id),
    device_class: 'window',
    state: `{{ is_state('${helper}', 'on') }}`,
  });
}

function addThermostat(pkg, labels) {
  const heater = heaterHelper();
  const label = labels.get(thermostatRoom);

  pkg.input_boolean[key(heater)] = { name: `${label} heater`, initial: false };
  pkg.climate.push({
    platform: 'generic_thermostat',
    name: `${label} thermostat`,
    unique_id: uniqueId(thermostatEntity()),
    heater,
    target_sensor: temperatureEntity(thermostatRoom),
    min_temp: 7,
    max_temp: 30,
    target_temp: 21,
    cold_tolerance: 0.3,
    hot_tolerance: 0.3,
    precision: 0.1,
    initial_hvac_mode: 'off',
  });
}

function addLock(pkg, templates) {
  const helper = lockHelper();

  pkg.input_boolean[key(helper)] = { name: 'Front door locked', initial: true };
  templates.lock.push({
    name: 'Front door lock',
    unique_id: uniqueId(lockEntity()),
    default_entity_id: lockEntity(),
    state: `{{ is_state('${helper}', 'on') }}`,
    lock: [{ action: 'input_boolean.turn_on', target: { entity_id: helper } }],
    unlock: [
      { action: 'input_boolean.turn_off', target: { entity_id: helper } },
    ],
  });
}

function addPlug(pkg, templates) {
  const helper = plugHelper();

  pkg.input_boolean[key(helper)] = { name: 'Television plug', initial: false };
  templates.switch.push({
    name: 'Television plug',
    unique_id: uniqueId(plugEntity()),
    default_entity_id: plugEntity(),
    state: `{{ is_state('${helper}', 'on') }}`,
    turn_on: [
      { action: 'input_boolean.turn_on', target: { entity_id: helper } },
    ],
    turn_off: [
      { action: 'input_boolean.turn_off', target: { entity_id: helper } },
    ],
  });
}

function addAlertSensor(pkg, templates, sensor, labels) {
  const helper = alertHelper(sensor);
  const name = `${labels.get(sensor.room) ?? sensor.room} ${sensor.label}`;

  pkg.input_boolean[key(helper)] = { name, initial: false };
  templates.binary_sensor.push({
    name,
    unique_id: uniqueId(alertEntity(sensor)),
    default_entity_id: alertEntity(sensor),
    device_class: sensor.deviceClass,
    state: `{{ is_state('${helper}', 'on') }}`,
  });
}

function addAlarm(pkg, templates) {
  const helper = alarmHelper();
  const choose = (option) => [
    {
      action: 'input_select.select_option',
      target: { entity_id: helper },
      data: { option },
    },
  ];

  pkg.input_select[key(helper)] = {
    name: 'House alarm state',
    options: ['disarmed', 'armed_home', 'armed_away', 'triggered'],
    initial: 'disarmed',
  };
  templates.alarm_control_panel.push({
    name: 'House alarm',
    unique_id: uniqueId(alarmEntity),
    default_entity_id: alarmEntity,
    code_arm_required: false,
    state: `{{ states('${helper}') }}`,
    arm_home: choose('armed_home'),
    arm_away: choose('armed_away'),
    disarm: choose('disarmed'),
    trigger: choose('triggered'),
  });
}

function openingName(kind, opening, labels, seen) {
  const [first, second] = opening.rooms.map((slug) => labels.get(slug) ?? slug);
  const name = second
    ? `${first} to ${second} ${kind}`
    : `${first ?? 'Outside'} ${kind}`;
  const nth = (seen.get(name) ?? 0) + 1;

  seen.set(name, nth);

  return nth > 1 ? `${name} ${nth}` : name;
}

function sensor(entityId, name, fields) {
  return {
    name,
    unique_id: uniqueId(entityId),
    default_entity_id: entityId,
    state_class: 'measurement',
    ...fields,
  };
}

function slider(name, min, max, initial) {
  return { name, min, max, step: 1, initial, mode: 'slider' };
}

function setValue(entityId, value) {
  return {
    action: 'input_number.set_value',
    target: { entity_id: entityId },
    data: { value },
  };
}

function roomLabels(model) {
  return new Map(model.rooms.map((room) => [room.slug, room.label]));
}

function uniqueId(entityId) {
  return `${uniquePrefix}_${entityId.replace('.', '_')}`;
}

function key(entityId) {
  return entityId.split('.')[1];
}
