import { render, screen } from '@testing-library/angular';
import { documentOf, exchangeRecord, producerRecord, queueRecord, consumerRecord, bindingRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { NODE_SIZE } from '@rmq/domain';
import { shapePath } from '../canvas/model/shapes';
import { EMPTY_THUMBNAIL, thumbnailOf } from './thumbnail';
import { ThumbnailView } from './thumbnail-view';

const sample = () =>
  thumbnailOf(
    documentOf({
      exchanges: { E1: exchangeRecord('x') },
      queues: { Q1: queueRecord('q') },
      producers: { P1: producerRecord('p', { kind: 'exchange', id: 'E1' }) },
      consumers: { C1: consumerRecord('c', ['Q1']) },
      bindings: { B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }) },
      nodes: { P1: { x: 0, y: 0 }, E1: { x: 400, y: 0 }, Q1: { x: 800, y: 0 }, C1: { x: 1200, y: 0 } },
    }),
  );

describe('ThumbnailView (ADR-0073)', () => {
  it('draws a canvas in one SVG whose view box is the box of the thumbnail', async () => {
    const thumbnail = sample();
    await render(ThumbnailView, { inputs: { thumbnail } });

    const { x, y, width, height } = thumbnail.box ?? { x: 0, y: 0, width: 0, height: 0 };
    expect(screen.getByTestId('thumbnail')).toHaveAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  });

  it('draws a path for each node, with the outline of its kind, at its own place, and a line for each edge', async () => {
    const { container } = await render(ThumbnailView, { inputs: { thumbnail: sample() } });

    const paths = [...container.querySelectorAll('path')];
    expect(paths.map((path) => path.getAttribute('d'))).toEqual([
      shapePath('exchange'),
      shapePath('queue'),
      shapePath('producer'),
      shapePath('consumer'),
    ]);
    expect(paths.map((path) => path.getAttribute('transform'))).toEqual([
      'translate(400 0)',
      'translate(800 0)',
      'translate(0 0)',
      'translate(1200 0)',
    ]);
    expect(container.querySelectorAll('line')).toHaveLength(3);
  });

  it('draws the outline of a node at the width of the node, wider for a longer name (ADR-0093)', async () => {
    const thumbnail = thumbnailOf(
      documentOf({ queues: { Q1: queueRecord('q'.repeat(30)) }, nodes: { Q1: { x: 0, y: 0 } } }),
    );
    const { container } = await render(ThumbnailView, { inputs: { thumbnail } });

    const node = thumbnail.nodes[0] ?? { width: 0, height: 0 };
    expect(node.width).toBeGreaterThan(NODE_SIZE.queue.width);
    expect(container.querySelector('path')?.getAttribute('d')).toBe(
      shapePath('queue', { width: node.width, height: node.height }),
    );
    expect(container.querySelector('path')?.getAttribute('d')).not.toBe(shapePath('queue'));
  });

  it('draws each edge from where it starts to where it ends', async () => {
    const thumbnail = sample();
    const { container } = await render(ThumbnailView, { inputs: { thumbnail } });

    const ends = [...container.querySelectorAll('line')].map((line) =>
      ['x1', 'y1', 'x2', 'y2'].map((name) => line.getAttribute(name)),
    );
    expect(ends).toEqual(thumbnail.edges.map(({ x1, y1, x2, y2 }) => [x1, y1, x2, y2].map(String)));
    expect(thumbnail.edges.some(({ x1, x2 }) => x1 !== x2)).toBe(true);
  });

  it('colours each kind with the colours of that kind, and keeps the lines thin at any size', async () => {
    const { container } = await render(ThumbnailView, { inputs: { thumbnail: sample() } });

    const classes = [...container.querySelectorAll('path')].map((path) => path.getAttribute('class'));
    expect(classes).toEqual([
      'fill-exchange-fill stroke-exchange',
      'fill-queue-fill stroke-queue',
      'fill-producer-fill stroke-producer',
      'fill-consumer-fill stroke-consumer',
    ]);
    for (const shape of container.querySelectorAll('path, line')) {
      expect(shape).toHaveAttribute('vector-effect', 'non-scaling-stroke');
    }
  });

  it('is decoration: a screen reader does not meet it', async () => {
    await render(ThumbnailView, { inputs: { thumbnail: sample() } });

    const svg = screen.getByTestId('thumbnail');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('says "Empty", out of the way of a screen reader, when there is nothing to draw', async () => {
    const { container } = await render(ThumbnailView, { inputs: { thumbnail: EMPTY_THUMBNAIL } });

    expect(screen.getByTestId('thumbnail-empty')).toHaveTextContent('Empty');
    expect(screen.getByTestId('thumbnail-empty')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toBeNull();
  });
});
