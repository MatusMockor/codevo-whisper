import { ROUTES, type Route } from './route';

export type RouteCounts = Readonly<Record<Route, number>>;

function zeroCounts(): Record<Route, number> {
  return Object.fromEntries(ROUTES.map((route) => [route, 0])) as Record<Route, number>;
}

export class RouteCounters {
  private readonly counts = zeroCounts();

  record(route: Route): void {
    this.counts[route] += 1;
  }

  total(): number {
    return ROUTES.reduce((sum, route) => sum + this.counts[route], 0);
  }

  snapshot(): RouteCounts {
    return Object.freeze({ ...this.counts });
  }
}
