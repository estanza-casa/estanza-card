import type { HomeDocument } from '@estanza/plan-engine';
import { homeDocumentSchema } from '@estanza/plan-engine/document';
import HomeScene from '@estanza/scene/components/HomeScene.js';
import { Children, isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ModelsLoaded } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';

type Drawn = {
  sceneTree: (source: HomeDocument, frameloop: 'demand') => ReactElement;
};

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
