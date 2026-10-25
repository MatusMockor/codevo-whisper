import { describe, expect, it } from 'vitest';
import { ServiceTimeEstimator } from '../../src/partials/service-time-estimator';

describe('ServiceTimeEstimator', () => {
  it('is unknown before the first sample', () => {
    expect(new ServiceTimeEstimator().valueMs).toBeUndefined();
  });

  it('the first sample initialises the estimate', () => {
    const estimator = new ServiceTimeEstimator();
    estimator.record(540);
    expect(estimator.valueMs).toBe(540);
  });

  it('smooths with alpha 0.3', () => {
    const estimator = new ServiceTimeEstimator();
    estimator.record(1000);
    estimator.record(2000);
    expect(estimator.valueMs).toBeCloseTo(1300);
  });
});
