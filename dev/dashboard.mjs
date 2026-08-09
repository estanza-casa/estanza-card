import {
  alarmHelper,
  alertHelper,
  doorHelper,
  heaterHelper,
  lockHelper,
  plugHelper,
  roomHelpers,
} from './entities.mjs';
import {
  alertSensors,
  doorEntity,
  lightEntity,
  lockedDoorId,
  lockEntity,
  plugEntity,
  plugProp,
  shareToken,
  thermostatEntity,
  windowEntity,
} from './home.mjs';

export function buildDashboard(home, model, areaIds, cardOrigin, registry) {
  const bindings = [
    ...model.rooms.map((room) => ({
      scope: { type: 'room', id: room.slug },
      area_id: areaIds[room.slug],
    })),
    ...model.lights.map((light) => ({
      scope: { type: 'light', id: light.slug },
      entity_id: lightEntity(light.slug),
    })),
    ...model.floors.flatMap((floor) => [
      ...floor.doors.map((door) =>
        door.id === lockedDoorId
          ? {
              scope: { type: 'door', id: door.id },
              entity_ids: [doorEntity(door.id), lockEntity()],
            }
          : {
              scope: { type: 'door', id: door.id },
              entity_id: doorEntity(door.id),
            },
      ),
      ...floor.windows.map((window) => ({
        scope: { type: 'window', id: window.id },
        entity_id: windowEntity(window.id),
      })),
    ]),
    { scope: { type: 'prop', id: plugProp }, entity_id: plugEntity() },
  ];

  const card = {
    type: 'custom:estanza-card',
    title: 'Casa Aurora',
    home_document: home,
    models_origin: cardOrigin,
    bindings,
    registry_ids: registryIdsOf(bindings, registry),
  };

  return {
    title: 'Estanza dev',
    views: [
      {
        title: 'Casa Aurora',
        path: 'casa-aurora',
        type: 'panel',
        cards: [card],
      },
      {
        title: 'Panel, no tablet',
        path: 'panel-plain',
        type: 'panel',
        cards: [{ ...card, tablet: 'off' }],
      },
      {
        title: 'Wall, quick idle',
        path: 'wall-quick',
        type: 'panel',
        cards: [{ ...card, idle_seconds: 6 }],
      },
      {
        title: 'Shared link',
        path: 'shared',
        type: 'panel',
        cards: [
          {
            ...card,
            home_document: undefined,
            share_id: shareToken,
            api_origin: cardOrigin,
          },
        ],
      },
      {
        title: 'Sections',
        path: 'sections',
        type: 'sections',
        sections: [{ type: 'grid', cards: [card] }],
      },
      {
        title: 'Tiles',
        path: 'tiles',
        type: 'sections',
        sections: [
          {
            type: 'grid',
            cards: [
              { ...card, grid_options: { columns: 12, rows: 2 } },
              { ...card, grid_options: { columns: 6, rows: 2 } },
              {
                ...card,
                grid_options: { columns: 6, rows: 2 },
                navigation_path: '/estanza-dev/casa-aurora',
              },
            ],
          },
        ],
      },
      {
        title: 'Masonry',
        path: 'masonry',
        type: 'masonry',
        cards: [card, ...controlCards(model)],
      },
      { title: 'Controls', path: 'controls', cards: controlCards(model) },
    ],
  };
}

function registryIdsOf(bindings, registry) {
  const idOf = new Map(registry.map((entry) => [entry.entity_id, entry.id]));
  const entityIds = [
    ...bindings.flatMap((binding) => [
      binding.entity_id,
      ...(binding.entity_ids ?? []),
    ]),
  ].filter((entityId) => entityId && idOf.has(entityId));

  return Object.fromEntries(
    [...new Set(entityIds)]
      .sort()
      .map((entityId) => [entityId, idOf.get(entityId)]),
  );
}

function controlCards(model) {
  const doors = model.floors.flatMap((floor) => floor.doors);

  return [
    { type: 'thermostat', entity: thermostatEntity() },
    {
      type: 'entities',
      title: 'Lights',
      entities: model.lights.map((light) => lightEntity(light.slug)),
    },
    {
      type: 'entities',
      title: 'Doors',
      entities: [...doors.map((door) => doorHelper(door.id)), lockHelper()],
    },
    { type: 'entities', title: 'Plugs', entities: [plugHelper()] },
    {
      type: 'entities',
      title: 'Alerts',
      entities: [...alertSensors.map(alertHelper), alarmHelper()],
    },
    {
      type: 'entities',
      title: 'Temperatures',
      entities: [
        heaterHelper(),
        ...model.rooms.map((room) => roomHelpers(room.slug).temperature),
      ],
    },
  ];
}
