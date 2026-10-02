import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { describe, expect, it } from 'vitest';

import { documentBindings, type SceneBinding } from '../src/bindings.js';
import homeFixture from './fixtures/home.json';

function linkedHome() {
  const draft = structuredClone(homeFixture);

  Object.assign(draft.additions, {
    props: [
      {
        slug: 'tv',
        type: 'tv',
        room: 'living-space',
        entity: 'media_player.living_tv',
      },
      { slug: 'sofa', type: 'sofa', room: 'living-space' },
      { slug: 'speaker', type: 'speaker', room: 'living-space' },
      {
        slug: 'heater',
        type: 'radiator',
        room: 'bathroom',
        entity: 'climate.bath',
        endpoint: 'heater-point',
      },
      { slug: 'broken', type: 'lamp', entity: 'not an entity' },
    ],
    cableEndpoints: [
      {
        slug: 'speaker-point',
        kind: 'socket',
        at: [10, 10],
        owner: 'speaker',
        entity: 'media_player.kitchen_speaker',
      },
      {
        slug: 'heater-point',
        kind: 'socket',
        at: [20, 20],
        owner: 'heater',
        entity: 'switch.heater_plug',
      },
      {
        slug: 'hall-light-point',
        kind: 'socket',
        at: [30, 30],
        owner: 'hall-light',
        entity: 'switch.hall_plug',
      },
      {
        slug: 'rack',
        kind: 'rack',
        at: [40, 40],
        entity: 'sensor.rack_temperature',
      },
    ],
  });
  draft.additions.lights[0] = {
    ...draft.additions.lights[0],
    entity: 'light.living_ceiling',
  } as (typeof draft.additions.lights)[number];

  return homeDocumentSchema.parse(draft);
}

describe('links made in the Estanza editor', () => {
  it('links a piece and a light to the entity the editor gave them', () => {
    expect(documentBindings(linkedHome(), [])).toEqual(
      expect.arrayContaining([
        {
          scope: { type: 'prop', id: 'tv' },
          entity_id: 'media_player.living_tv',
        },
        {
          scope: { type: 'light', id: 'living-space-light' },
          entity_id: 'light.living_ceiling',
        },
      ]),
    );
  });

  it('links a piece through the socket it owns when it has no entity of its own', () => {
    const links = documentBindings(linkedHome(), []);

    expect(links).toContainEqual({
      scope: { type: 'prop', id: 'speaker' },
      entity_id: 'media_player.kitchen_speaker',
    });
    expect(links).toContainEqual({
      scope: { type: 'light', id: 'hall-light' },
      entity_id: 'switch.hall_plug',
    });
    expect(links).toContainEqual({
      scope: { type: 'prop', id: 'heater' },
      entity_id: 'climate.bath',
    });
    expect(links).not.toContainEqual(
      expect.objectContaining({ entity_id: 'switch.heater_plug' }),
    );
  });

  it('leaves out a socket that belongs to no piece, an unlinked piece and a value that is no entity', () => {
    const ids = documentBindings(linkedHome(), []).map(
      (binding) => binding.entity_id,
    );

    expect(ids).not.toContain('sensor.rack_temperature');
    expect(ids).not.toContain('not an entity');
    expect(ids).toHaveLength(5);
  });

  it('lets the card’s own link for a thing win over the editor’s', () => {
    const own: SceneBinding = {
      scope: { type: 'prop', id: 'tv' },
      entity_id: 'switch.tv_plug',
      tap_action: { action: 'none' },
    };
    const links = documentBindings(linkedHome(), [own]);

    expect(links[0]).toBe(own);
    expect(links.filter((binding) => binding.scope.id === 'tv')).toEqual([own]);
  });

  it('keeps the card’s links as they are when the home has none', () => {
    const own: SceneBinding[] = [
      { scope: { type: 'room', id: 'hall' }, area_id: 'hall' },
    ];

    expect(documentBindings(homeDocumentSchema.parse(homeFixture), own)).toBe(
      own,
    );
    expect(documentBindings(null, own)).toBe(own);
  });
});
