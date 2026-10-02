import type { HomeDocument } from '@estanza/plan-engine';
import { homeDocumentSchema } from '@estanza/plan-engine/document';
import HomeScene from '@estanza/scene/components/HomeScene.js';
import type { ModelSource } from '@estanza/scene/components/Prop.js';
import { Children, isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { catalogOnly, ModelsLoaded } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';

type Drawn = {
  sceneTree: (source: HomeDocument, frameloop: 'demand') => ReactElement;
};

type HomeSceneProps = { home: HomeDocument; models?: ModelSource };

type Loading = ReactElement<{
  urls: string[];
  onLoaded: (urls: string[]) => void;
}>;

const furnished = homeDocumentSchema.parse({
  ...homeFixture,
  additions: {
    ...homeFixture.additions,
    props: [
      { slug: 'sofa', type: 'catalog', catalogId: 'loungeSofa' },
      { slug: 'socket', type: 'plug' },
    ],
  },
});

function everything(tree: ReactElement): ReactElement[] {
  const children = (tree.props as { children?: unknown }).children;

  return Children.toArray(children as ReactElement[])
    .filter((child): child is ReactElement => isValidElement(child))
    .flatMap((child) => [child, ...everything(child)]);
}

function drawn(view: HTMLElement): ReactElement[] {
  return everything((view as unknown as Drawn).sceneTree(furnished, 'demand'));
}

function propsDrawn(view: HTMLElement): string[] {
  const scene = drawn(view).find((child) => child.type === HomeScene);

  return (scene?.props as { home: HomeDocument }).home.additions.props.map(
    (prop) => prop.slug,
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('furniture before its models arrive', () => {
  it('draws no stand-in box for a piece whose model is still loading', () => {
    const view = document.createElement('estanza-scene-view');

    view.homeDocument = furnished;
    document.body.append(view);

    expect(propsDrawn(view)).toEqual(['socket']);
  });

  it('draws the piece once its model has loaded', () => {
    const view = document.createElement('estanza-scene-view');

    view.homeDocument = furnished;
    document.body.append(view);

    const loading = drawn(view).find(
      (child): child is Loading => child.type === ModelsLoaded,
    );

    expect(loading?.props.urls).toHaveLength(1);

    loading?.props.onLoaded(loading.props.urls);

    expect(propsDrawn(view)).toEqual(['sofa', 'socket']);
  });
});

describe('loading the furniture models', () => {
  const manager = catalogOnly('https://app.estanza.casa/assets/props');

  it('lets a furniture model load from the furniture address and its own pictures', () => {
    expect(
      manager.resolveURL('https://app.estanza.casa/assets/props/sofa.glb'),
    ).toBe('https://app.estanza.casa/assets/props/sofa.glb');
    expect(manager.resolveURL('blob:https://app.estanza.casa/1')).toBe(
      'blob:https://app.estanza.casa/1',
    );
  });

  it('refuses any other address', () => {
    expect(manager.resolveURL('https://evil.example/track.png')).toBe('data:,');
    expect(
      manager.resolveURL('https://app.estanza.casa/assets/props-other/x.glb'),
    ).toBe('data:,');
  });
});

describe('a model the owner uploaded', () => {
  const modelId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const uploaded = homeDocumentSchema.parse({
    ...homeFixture,
    additions: {
      ...homeFixture.additions,
      props: [
        {
          slug: 'speaker',
          type: 'model',
          modelId,
          width: 30,
          length: 30,
          height: 90,
        },
      ],
    },
  });

  function sceneOf(view: HTMLElement): HomeSceneProps {
    const tree = (view as unknown as Drawn).sceneTree(uploaded, 'demand');
    const scene = everything(tree).find((child) => child.type === HomeScene);

    return scene?.props as HomeSceneProps;
  }

  it('is drawn from the share the card reads its home from', () => {
    const view = document.createElement('estanza-scene-view');

    view.shareId = 'abc123';
    view.apiOrigin = 'https://api.example.test';
    document.body.append(view);

    const scene = sceneOf(view);

    expect(scene.home.additions.props.map((prop) => prop.slug)).toEqual([
      'speaker',
    ]);
    expect(scene.models?.url(modelId)).toBe(
      `https://api.example.test/v1/integrations/home-assistant/abc123/models/${modelId}`,
    );
    expect(scene.models?.withCredentials).toBe(false);
  });

  it('stays a plain box when the home was pasted in without a share', () => {
    const view = document.createElement('estanza-scene-view');

    view.homeDocument = uploaded;
    document.body.append(view);

    expect(sceneOf(view).models?.url(modelId)).toBeNull();
  });
});
