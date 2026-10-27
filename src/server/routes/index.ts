import { Router } from '../http/router';
import { authRoutes } from './auth';
import { brainRoutes } from './brain';
import { taskRoutes } from './tasks';
import { settingsRoutes } from './settings';
import { applicationRoutes } from './applications';
import { dashboardRoutes } from './dashboard';

export function buildRouter(): Router {
  const r = new Router();
  authRoutes(r);
  brainRoutes(r);
  taskRoutes(r);
  settingsRoutes(r);
  applicationRoutes(r);
  dashboardRoutes(r);
  return r;
}
