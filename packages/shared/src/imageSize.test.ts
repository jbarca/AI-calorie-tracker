import { describe, expect, it } from 'vitest';

import { resizeForLongEdge } from './imageSize.ts';

describe('resizeForLongEdge', () => {
  it('constrains the long edge', () => {
    expect(resizeForLongEdge(4032, 3024)).toEqual({ width: 1024 });
    expect(resizeForLongEdge(3024, 4032)).toEqual({ height: 1024 });
    expect(resizeForLongEdge(2000, 2000, 500)).toEqual({ width: 500 });
  });

  it('leaves small or unknown sizes alone', () => {
    expect(resizeForLongEdge(800, 600)).toBeNull();
    expect(resizeForLongEdge(1024, 768)).toBeNull();
    expect(resizeForLongEdge(0, 0)).toBeNull();
  });
});
